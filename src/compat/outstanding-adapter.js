/* Read-only outstanding notices: reuse the frozen original implementation.
 * No new document number, sale, payment, invoice or Firestore write occurs.
 * A notice is a read-only projection of an existing confirmed invoice.
 */
'use strict';
const Old=require('../../legacy-pdf/source/js/outstanding.js');
const B=require('../core/business');
function previewOutstanding(state,documentId,issueDate){
 const documents=B.list(state,'documents');
 const doc=documents.find(x=>x.id===documentId);
 if(!doc||!['invoice','onoda'].includes(doc.docType)||doc.status!=='active')throw Error('有効な請求書が必要です');
 if(!doc.saleId)throw Error('請求書の売上参照がありません');
 const sales=B.list(state,'sales'),sale=sales.find(x=>x.id===doc.saleId);
 if(!sale||sale.status!=='active')throw Error('請求書と売上の関連を確認してください');
 const payments=B.list(state,'payments').filter(x=>x.saleId===sale.id);
 const original={...doc,documentId:doc.id,snapshot:{...doc.snapshot,documentId:doc.id,docType:doc.docType},
   status:doc.status,confirmed:true};
 const view=Old.view(original,sale,payments);
 const notice=Old.notice(view,issueDate);
 return {filename:notice.filename,note:notice.note,invoiceAmount:notice.invoiceAmount,
  paidAmount:notice.paidAmount,outstandingAmount:notice.outstandingAmount,
  originalInvoiceNo:notice.invoiceNo,originalDocumentId:doc.id,originalSaleId:sale.id,
  period:notice.period,readonly:true};
}
module.exports={previewOutstanding};
