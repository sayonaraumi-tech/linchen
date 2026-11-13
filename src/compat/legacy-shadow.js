/* Legacy geruninn read-only bridge.
 * Preserve original 15 collections, IDs, payloads and unknown fields exactly.
 * This is a shadow projection, not a write-enabled migration.
 * One old receivable may be the payment.saleId anchor; do not convert it to
 * an independent 'sale' and accidentally count revenue twice.
 */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./legacy-contract'):root.TsukinowaLegacyCompatibility);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.TsukinowaLegacyShadow=api;
})(globalThis,function(C){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const safeMoney=(value,name)=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0)throw Error(name+' must be a nonnegative integer JPY value');
 return n;
};
const isActive=x=>x&&!x.deletedAt&&x.status!=='void'&&x.status!=='cancelled'&&x.documentStatus!=='void';
const confirmed=p=>p.confirmation==='cash-received'||p.confirmation==='bank-confirmed';
function rowsOf(input){
 if(Array.isArray(input))return input;
 if(input&&typeof input==='object')return Object.values(input);
 return [];
}
function normalizeRow(value,collection){
 const envelope=value&&value.payload&&typeof value.payload==='object'?value.payload:value;
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))throw Error('Invalid '+collection+' record');
 const id=String(value.id||envelope.id||'');
 if(!id)throw Error('Legacy record has no ID: '+collection);
 return {id,payload:clone(envelope),envelope:clone(value)};
}
function verifyShadow(dump,{requireFullExport=true}={}){
 if(!dump||typeof dump!=='object'||Array.isArray(dump))throw Error('Legacy export must be a map');
 if(requireFullExport){
  const missing=C.LEGACY_COLLECTIONS.filter(name=>!Object.prototype.hasOwnProperty.call(dump,name));
  if(missing.length)throw Error('Legacy export is incomplete: '+missing.join(', '));
 }
 const inventory=C.validateLegacyDump(dump,{strictCollections:true,strictLinks:true});
 if(inventory.issues.length){
  const kinds=[...new Set(inventory.issues.map(x=>x.code))];
  throw Error('Legacy data audit blocked: '+kinds.join(', '));
 }
 const collections={};
 for(const name of C.LEGACY_COLLECTIONS){
  const index=new Map();
  for(const value of rowsOf(dump[name])){
   const row=normalizeRow(value,name);
   if(index.has(row.id))throw Error('Duplicate old ID '+name+'/'+row.id);
   index.set(row.id,row);
  }
  collections[name]=index;
 }
 return {collections,inventory};
}
function createShadow(dump,{requireFullExport=false}={}){
 const {collections,inventory}=verifyShadow(dump,{requireFullExport});
 const get=(name,id)=>collections[name]?.get(String(id||''))?.payload||null;
 const rows=name=>[...(collections[name]?.values()||[])].map(x=>clone(x.payload));
 const oldDocument=id=>get('documents',id);
 const oldSale=id=>get(String(id).startsWith('receivable_')?'receivables':'sales',id);
 const paymentsFor=id=>rows('payments').filter(p=>p.saleId===id&&isActive(p));
 function receivableRows(){
  const anchors=[...rows('sales'),...rows('receivables')];
  return anchors.filter(isActive).map(item=>{
   const id=String(item.id||item.saleId||item.receivableId||'');
   if(!id)throw Error('Legacy receivable anchor is missing an id');
   const amount=safeMoney(item.amount,'original sale/receivable amount');
   const pays=paymentsFor(id);
   const pending=pays.filter(x=>!confirmed(x)).reduce((n,p)=>n+safeMoney(p.amount,'pending payment'),0);
   const collected=pays.filter(confirmed).reduce((n,p)=>n+safeMoney(p.amount,'confirmed payment'),0);
   if(collected>amount||pending+collected>amount)throw Error('Legacy receivable overpaid or reserved: '+id);
   return {id,sourceCollection:String(id).startsWith('receivable_')?'receivables':'sales',
    customer:item.customer||item.customerName||'',amount,confirmedPaid:collected,pending,
    outstanding:amount-collected,paymentIds:pays.map(p=>p.id||p.paymentId),
    originalId:id,readonly:true};
  });
 }
 function calendarRows(){
  return rows('calendarLinks').map(e=>({
   originalId:String(e.id||''),source:'legacy-calendarLinks',status:e.status||'',
   date:e.workDate||e.date||'',title:e.title||'',googleEventId:e.googleEventId||'',
   googleCalendarId:e.googleCalendarId||e.calendarId||'',
   saleIds:[e.saleId,e.cashSaleId,e.receiptSaleId].filter(Boolean),
   documentIds:[e.documentId,e.linkedInvoiceId,e.linkedReceiptId].filter(Boolean),
   estimateId:e.linkedEstimateId||e.estimateId||'',raw:clone(e),readonly:true
  }));
 }
 function estimatesRows(){
  return rows('estimates').map(e=>({originalId:String(e.id||''),historyId:e.historyId||'',
   documentId:e.documentId||'',projectId:e.projectId||'',workDate:e.workDate||'',
   amount:e.amount,customer:e.customer||e.customerName||'',raw:clone(e),readonly:true}));
 }
 function reconcile(){
  const orphanPayments=[];
  for(const p of rows('payments'))if(isActive(p)&&p.saleId&&!oldSale(p.saleId))
   orphanPayments.push({paymentId:p.id||p.paymentId||'',saleId:p.saleId});
  const orphanDocuments=[];
  for(const d of rows('documents'))if(isActive(d)&&d.saleId&&!oldSale(d.saleId))
   orphanDocuments.push({documentId:d.id||d.documentId||'',saleId:d.saleId});
  const orphanCalendar=[];
  for(const e of calendarRows()){
   const missing=e.saleIds.filter(id=>!oldSale(id));
   if(missing.length)orphanCalendar.push({id:e.originalId,missingSaleIds:missing});
  }
  const ledger=receivableRows();
  return {readonly:true,orphanPayments,orphanDocuments,orphanCalendar,
   totals:{anchors:ledger.length,amount:ledger.reduce((n,x)=>n+x.amount,0),
    collected:ledger.reduce((n,x)=>n+x.confirmedPaid,0),
    outstanding:ledger.reduce((n,x)=>n+x.outstanding,0)},
   canPromote:orphanPayments.length===0&&orphanDocuments.length===0&&orphanCalendar.length===0};
 }
 return {readonly:true,inventory,rows,get,oldDocument,oldSale,paymentsFor,receivableRows,calendarRows,estimatesRows,reconcile};
}
return {createShadow,verifyShadow};
});
