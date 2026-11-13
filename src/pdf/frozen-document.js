/* Read-only formal PDF boundary.
 * The actual renderer must be the frozen legacy renderer, not a new template.
 * Downloading a saved PDF never calls saveDocument or any accounting command.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaFrozenPdf=api;})(globalThis,function(){
'use strict';
const DOCUMENT_TYPES=new Set(['estimate','invoice','receipt','onoda']);
function createFrozenPdfService({loadDocument,exportLegacyPDF,filenameForSnapshot}={}){
 if(typeof loadDocument!=='function'||typeof exportLegacyPDF!=='function'||typeof filenameForSnapshot!=='function')throw Error('PDFアダプターの依存関係が不足しています');
 async function download(documentId){
  if(typeof documentId!=='string'||!documentId.trim())throw Error('帳票IDが必要です');
  const doc=await loadDocument(documentId);
  if(!doc||!DOCUMENT_TYPES.has(doc.docType)||!doc.snapshot||!doc.invoiceNo)throw Error('確定帳票が見つかりません');
  const frozen=JSON.parse(JSON.stringify(doc.snapshot));
  if(frozen.invoiceNo!==doc.invoiceNo)throw Error('確定番号の整合性がありません');
  if(frozen.docType&&frozen.docType!==doc.docType)throw Error('帳票種類が一致しません');
  frozen.docType=doc.docType;
  const canonical=JSON.stringify(frozen);
  const filename=filenameForSnapshot({...frozen,documentId:doc.id,docType:doc.docType});
  if(typeof filename!=='string'||!filename.endsWith('.pdf'))throw Error('帳票ファイル名が不正です');
  const pdf=await exportLegacyPDF({snapshot:frozen,filename,docType:doc.docType});
  if(JSON.stringify(frozen)!==canonical)throw Error('PDF出力中に正式snapshotが変更されました');
  if(!pdf||!(pdf instanceof Uint8Array)&&!Buffer.isBuffer(pdf))throw Error('PDFレンダラーはバイナリを返す必要があります');
  const header=Array.from(pdf.slice(0,4)).map(x=>String.fromCharCode(x)).join('');
  if(header!=='%PDF')throw Error('PDFファイルのヘッダーが不正です');
  return {filename,bytes:pdf,documentId:doc.id,invoiceNo:doc.invoiceNo};
 }
 return {download};
}
return {createFrozenPdfService};
});
