'use strict';

const {getAuth} = require('firebase-admin/auth');
const {createTrustedRepository} = require('./firebase-repository.cjs');
const {createCommandService, META_ID, RevisionConflict} = require('../../src/services/command-service');

const MAX_REQUEST_BYTES = 12_288;
const MAX_PENDING_MS = 15 * 60 * 1000;
const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const safeId = /^[a-zA-Z0-9_-]{1,128}$/;
const requiredText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const optionalText = value => typeof value === 'string' && value.length <= 1000;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const schemas = {
  saveCustomer: {required: {name: requiredText}, optional: {address: optionalText}},
  saveSchedule: {required: {date, title: requiredText}, optional: {
    customer: optionalText, description: optionalText, location: optionalText,
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
  const fields = {...required, ...optional, id: value => typeof value === 'string' &&
    safeId.test(value) && !Object.hasOwn(Object.prototype, value)};
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
    if (new URL(request.url).pathname !== '/api/commands') return response(404, {error: 'not_found'});
    if (!['GET', 'POST'].includes(request.method)) return response(405, {error: 'method_not_allowed'});
    const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '');
    if (!bearer) return response(401, {error: 'authentication_required'});
    let claims;
    try {
      claims = await auth.verifyIdToken(bearer[1], true);
    } catch {
      return response(401, {error: 'authentication_required'});
    }
    if (claims.companyId !== companyId || claims.role !== 'admin' || claims.linchenSandbox === true) {
      return response(403, {error: 'forbidden'});
    }

    const repository = createTrustedRepository(app, {uid: claims.uid, companyId, role: claims.role});
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
      return response(200, await createCommandService({repository}).execute(command));
    } catch (error) {
      if (error instanceof RevisionConflict || error.message.startsWith('版数競合:') ||
          error.message.startsWith('同一操作ID')) return response(409, {error: 'conflict'});
      if (['編集対象の記録がありません', '無効な顧客を直接上書きできません',
           '連携済日程は専用の訂正手続が必要です', '小野田の施工数量は正数で入力してください',
           '取消済日程は通常保存で復活できません', '既存帳票・売上に関係する取引先名の変更には専用の訂正手続が必要です'].includes(error.message)) {
        return response(422, {error: 'invalid_change', message: error.message});
      }
      return response(503, {error: 'unavailable'});
    }
  };
}

module.exports = {createCommandHandler};
