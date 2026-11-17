'use strict';

const {draftOnodaInvoice} = require('../../src/core/schedule-calendar');
const {createHash} = require('node:crypto');
const {decodeBytes} = require('../../src/integrations/bank-import');
const {parseCSV, inspectImport} = require('../../src/integrations/bank-csv');
const {documentTotals} = require('../../src/core/document-totals');

function prepareCommand(state, command) {
  const {type, operationId} = command;
  if (type === 'importBankCSV') {
    const bytes = Buffer.from(command.base64, 'base64');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const evidenceId = 'bank_csv_' + createHash('sha256').update(command.account).update(digest).digest('hex');
    const parsed = parseCSV(decodeBytes(bytes), {account: command.account});
    if (parsed.errors.length) throw Error('銀行CSVの不正行: ' + parsed.errors.map(error => error.line).join(', '));
    if (!parsed.entries.length || parsed.entries.length > 5) throw Error('この隔離版ではCSVは1〜5明細です');
    const existing = Object.values(state.collections.bankTransactions).map(row => ({...row, identity: row.externalId}));
    const result = inspectImport(existing, parsed.entries);
    if (result.review.length) throw Error('安全に重複確認できる取引番号または残高のあるCSVが必要です');
    return {type: 'importBankCSV', operationId, evidenceId, digest, base64: command.base64,
      filename: command.filename, account: parsed.account, entries: result.accepted,
      duplicates: result.duplicates.length};
  }
  if (type === 'issueOnoda') {
    const snapshot = draftOnodaInvoice(state, command);
    const selected = new Set(command.selectedIds);
    const alreadyBilled = Object.values(state.collections.documents).some(document =>
      document.docType === 'onoda' && document.status === 'active' &&
      document.snapshot?.items?.some(item => selected.has(item.sourceEventId)));
    if (alreadyBilled) throw Error('発行済みの小野田明細が含まれています');
    return {type: 'issueDocument', operationId, docType: 'onoda',
      snapshot, amount: documentTotals(snapshot).total, sourceKey: operationId};
  }
  if (type === 'issueDocument') {
    const {docType, customerName, invoiceDate, description, price, discount = 0} = command;
    if (discount && (docType !== 'invoice' || discount >= price)) throw Error('値引き金額を確認してください');
    const items = [{content: description, qty: 1, price, taxable: true, unit: '式'}];
    if (discount) items.push({content: '値引き', qty: 1, price: -discount, taxable: true, unit: '式'});
    const snapshot = {customerName, invoiceDate, docType, items,
      ...(docType === 'receipt' ? {receiptTotal: price, paymentMethod: '現金', tadashi: description} : {})};
    return {type, operationId, docType, sourceKey: operationId, snapshot,
      amount: documentTotals(snapshot).total};
  }
  if (type === 'reviseDocument') {
    const original = state.collections.documents[command.documentId];
    if (!original) throw Error('確定帳票が見つかりません');
    return {...command, amount: original.amount,
      newSnapshot: {...original.snapshot, customerName: command.customerName}};
  }
  if (type === 'voidRecord' && command.collection === 'schedule' &&
      Object.values(state.collections.documents).some(document =>
        document.status === 'active' && document.snapshot?.items?.some(item => item.sourceEventId === command.id))) {
    throw Error('発行済み請求書と関連する日程は取消できません');
  }
  return command;
}

module.exports = {prepareCommand};
