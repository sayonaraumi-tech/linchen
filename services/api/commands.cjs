'use strict';

const {getAuth} = require('firebase-admin/auth');
const {createTrustedRepository} = require('./firebase-repository.cjs');
const {createCommandService, META_ID, RevisionConflict, DomainInputError} = require('../../src/services/command-service');

const Domain = require('../../src/core/business');
const {STAFF_READ} = require('../../src/storage/firestore-repository');
const {prepareCommand} = require('./prepare-command.cjs');
const {archivedPdf} = require('./pdf-archive.cjs');

const MAX_REQUEST_BYTES = 12_288;
const MAX_PENDING_MS = 15 * 60 * 1000;
const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const safeId = /^[a-zA-Z0-9_-]{1,128}$/;
const requiredText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const optionalText = value => typeof value === 'string' && value.length <= 1000;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const id = value => typeof value === 'string' && safeId.test(value) && !Object.hasOwn(Object.prototype, value);
const choice = (...values) => value => values.includes(value);
const positiveYen = value => Number.isSafeInteger(value) && value > 0;
const yen = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === Object.keys(fields).length &&
  Object.entries(fields).every(([key, validate]) => Object.hasOwn(value, key) && validate(value[key]));
const schemas = {
  importBankCSV: {required: {filename: requiredText, account: requiredText,
    base64: value => typeof value === 'string' && value.length > 0 && value.length <= 8192 &&
      value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)}},

  saveExpense: {required: {expenseDate: date, vendor: requiredText, category: requiredText,
    amount: positiveYen, paymentMethod: choice('現金', '銀行振込', '法人信用カード', '代表者立替')},
    optional: {id, description: optionalText}},
  registerScheduleSale: {required: {scheduleId: id, amount: positiveYen, salesDate: date}, optional: {cash: choice(true)}},
  registerPayment: {required: {saleId: id, amount: positiveYen, paymentDate: date, method: choice('現金', '銀行振込')}},
  issueDocument: {required: {docType: choice('estimate', 'invoice', 'receipt'), customerName: requiredText,
    invoiceDate: date, description: requiredText, price: positiveYen}, optional: {discount: yen}},
  issueOnoda: {required: {
    month: value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value),
    selectedIds: value => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(id),
    invoiceDate: date, billing: value => exact(value, {customerName: requiredText, unitPrice: positiveYen,
      taxable: item => typeof item === 'boolean'}),
  }},
  issueReceiptForPayment: {required: {paymentId: id}},
  acceptEstimate: {required: {estimateId: id, workDate: date}},
  convertEstimateToInvoice: {required: {estimateId: id, invoiceDate: date}},
  reviseDocument: {required: {documentId: id, reason: requiredText, customerName: requiredText}},
  voidDocument: {required: {documentId: id, reason: requiredText}},
  voidRecord: {required: {id, collection: choice('customers', 'schedule', 'expenses', 'payments'), reason: requiredText}},
  restoreRecord: {required: {id, collection: choice('customers', 'schedule', 'expenses'), confirmRestore: choice(true)}},
  matchBankPayment: {required: {bankTxnId: id, paymentId: id}},
  matchBankExpense: {required: {bankTxnId: id, expenseId: id}},
  unmatchBank: {required: {bankTxnId: id}},

  saveCustomer: {required: {name: requiredText}, optional: {id, address: optionalText}},
  saveSchedule: {required: {date, title: requiredText}, optional: {
    id, customer: optionalText, description: optionalText, location: optionalText,
    kind: value => ['見積', 'その他', '小野田'].includes(value),
    onodaQuantity: value => value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0),
  }},
};

function matches(command, now) {
  if (!command || typeof command !== 'object' || Array.isArray(command) ||
      !Object.hasOwn(schemas, command.type) || typeof command.operationId !== 'string' ||
      !operationId.test(command.operationId) || !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 0 || !Number.isSafeInteger(command.expiresAt) ||
      command.expiresAt <= now || command.expiresAt > now + MAX_PENDING_MS) return false;
  const {required, optional} = schemas[command.type];
  const fields = {...required, ...optional};
  return Object.entries(required).every(([key, validate]) => validate(command[key])) &&
    Object.entries(command).every(([key, value]) =>
      ['operationId', 'type', 'expectedRevision', 'expiresAt'].includes(key) ||
      (Object.hasOwn(fields, key) && fields[key](value)));
}

async function readCommand(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
      length += value.length;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function response(status, data) {
  return Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
}

function createCommandHandler({app, companyId}) {
  const projectId = app.options.projectId;
  if (!projectId || projectId === 'tsukinowa-business' || typeof companyId !== 'string' ||
      !safeId.test(companyId) || Object.hasOwn(Object.prototype, companyId)) {
    throw new Error('A separate linchen Firebase project and company ID are required');
  }
  const auth = getAuth(app);

  return async function handle(request) {
    const url = new URL(request.url);
    if (!['/api/commands', '/api/workspace', '/api/pdf'].includes(url.pathname)) return response(404, {error: 'not_found'});
    if (request.method !== 'GET' && !(url.pathname !== '/api/workspace' && request.method === 'POST')) {
      return response(405, {error: 'method_not_allowed'});
    }
    const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '');
    if (!bearer) return response(401, {error: 'authentication_required'});
    let claims;
    try {
      claims = await auth.verifyIdToken(bearer[1], true);
    } catch {
      return response(401, {error: 'authentication_required'});
    }
    if (claims.companyId !== companyId || !['admin', 'staff'].includes(claims.role) || claims.linchenSandbox === true ||
        ((url.pathname === '/api/commands' || request.method === 'POST') && claims.role !== 'admin')) {
      return response(403, {error: 'forbidden'});
    }

    const repository = createTrustedRepository(app, {uid: claims.uid, companyId, role: claims.role});
    const service = createCommandService({repository, maximumChanges: 8, prepare: prepareCommand});
    if (url.pathname === '/api/workspace') {
      try {
        if (claims.role === 'admin') {
          const {state, revision} = await service.load();
          for (const [id, record] of Object.entries(state.collections.settings)) {
            if (record.type === 'bankCSV') delete state.collections.settings[id];
          }
          return response(200, {state, revision, role: 'admin'});
        }
        const state = Domain.emptyState('production');
        const groups = await Promise.all(STAFF_READ.map(async name => [name, await repository.list(name, 2001)]));
        if (groups.reduce((count, [, records]) => count + records.length, 0) > 2000) {
          return response(503, {error: 'unavailable'});
        }
        for (const [name, records] of groups) {
          state.collections[name] = Object.fromEntries(records.map(record => [record.id, record.payload]));
        }
        return response(200, {state, revision: null, role: 'staff'});
      } catch (error) {
        return response(error instanceof RevisionConflict ? 409 : 503, {error: 'unavailable'});
      }
    }
    if (url.pathname === '/api/pdf') {
      const documentId = url.searchParams.get('id');
      if (!id(documentId)) return response(400, {error: 'invalid_document'});
      try {
        const saved = await repository.read('documents', documentId);
        if (!saved) return response(404, {error: 'not_found'});
        const result = await archivedPdf({app, companyId, document: saved.payload, actorId: claims.uid,
          archive: request.method === 'POST'});
        if (!result) return response(404, {error: 'not_found'});
        const {bytes, filename} = result;
        return new Response(bytes, {headers: {'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
          'X-Document-Filename': encodeURIComponent(filename)}});
      } catch {
        return response(503, {error: 'pdf_unavailable'});
      }
    }
    if (request.method === 'GET') {
      try {
        const metadata = await repository.read('settings', META_ID);
        return response(200, {revision: metadata?.revision ?? 0});
      } catch {
        return response(503, {error: 'unavailable'});
      }
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return response(415, {error: 'json_required'});
    }
    let command;
    try {
      command = await readCommand(request);
    } catch {
      return response(400, {error: 'invalid_command'});
    }
    if (!matches(command, Date.now())) return response(400, {error: 'invalid_command'});
    try {
      return response(200, await service.execute(command));
    } catch (error) {
      if (error instanceof RevisionConflict || error.message.startsWith('版数競合:') ||
          error.message.startsWith('同一操作ID')) return response(409, {error: 'conflict'});
      if (error instanceof DomainInputError || ['編集対象の記録がありません', '無効な顧客を直接上書きできません',
           '連携済日程は専用の訂正手続が必要です', '小野田の施工数量は正数で入力してください',
           '取消済日程は通常保存で復活できません', '既存帳票・売上に関係する取引先名の変更には専用の訂正手続が必要です'].includes(error.message)) {
        return response(422, {error: 'invalid_change', message: error.message});
      }
      return response(503, {error: 'unavailable'});
    }
  };
}

module.exports = {createCommandHandler};
