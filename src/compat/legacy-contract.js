/* Read-only legacy contract verification. This module must never write or
 * silently convert data; unsupported legacy collections require explicit
 * mapping before migration. Source: geruninn@6674e019731b7fbc490e52e32fed348f7c0b7a6d.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaLegacyCompatibility=api;})(globalThis,function(){
'use strict';
const SOURCE_COMMIT='6674e019731b7fbc490e52e32fed348f7c0b7a6d';
const LEGACY_COLLECTIONS=Object.freeze(['calendarLinks','estimates','projects','documents','sales','receivables','payments','expenses','suppliers','cashLedger','auditLogs','settings','bankTransactions','supplierTransactions','migrations']);
const NEW_COLLECTIONS=Object.freeze(['settings','customers','projects','schedule','documents','sales','payments','expenses','cashLedger','bankTransactions','suppliers','supplierTransactions','auditLogs']);
const MAPPING=Object.freeze({
 calendarLinks:{target:'schedule',mode:'explicit-link',reason:'原CalendarLinkのsaleId・linkedInvoiceId・Google eventIdを保護'},
 estimates:{target:null,mode:'blocked',reason:'見積と受注案件の独立ライフサイクルが未実装'},
 projects:{target:'projects',mode:'needs-schema-review',reason:'workDate,estimateId,acceptedDate,calendarIdを照合'},
 documents:{target:'documents',mode:'needs-schema-review',reason:'正式snapshot,confirmed,deletedAt,revisedFromDocumentId,documentIdを不変保管'},
 sales:{target:'sales',mode:'needs-schema-review',reason:'sourceId,estimateId,saleId,documentId,amount,入金リンクを照合'},
 receivables:{target:null,mode:'blocked',reason:'旧未収元帳に対応する独立collectionがなく自動欠落の危険'},
 payments:{target:'payments',mode:'needs-schema-review',reason:'paymentId,confirmation,bankTxnId,linkedDocumentIdの照合'},
 expenses:{target:'expenses',mode:'needs-schema-review',reason:'費用科目,bankAccount,attachmentRef,deletedAt,支払方法の照合'},
 suppliers:{target:'suppliers',mode:'needs-schema-review',reason:'期首預り金,仕入先ID,仕入先残高の照合'},
 cashLedger:{target:'cashLedger',mode:'needs-schema-review',reason:'linkedPaymentId,linkedExpenseId,linkedSupplierTransactionIdが必要'},
 auditLogs:{target:'auditLogs',mode:'archive-only',reason:'旧監査は変更/再採番せず保管'},
 settings:{target:'settings',mode:'needs-schema-review',reason:'会社登録番号,銀行,請求番号,学習ルール等の互換性'},
 bankTransactions:{target:'bankTransactions',mode:'needs-schema-review',reason:'CSV原摘要,externalId,重複occurrence,除外,過去照合を維持'},
 supplierTransactions:{target:'supplierTransactions',mode:'needs-schema-review',reason:'請求月,prepayment,adjustment,bankTxnIdを維持'},
 migrations:{target:null,mode:'archive-only',reason:'既存移行マーカーは履歴として保存し新システムに再実行しない'},
});
const LOCAL_KEYS=Object.freeze({
 business:'tsukinowa_business_v1',
 documents:'tsukinowa_chohyo_confirmed_history_v1',
 settings:'tsukinowa_business_settings_v1'
});
const REQUIRED_LINKS=Object.freeze({
 documents:['saleId','paymentId','estimateId','revisedFromDocumentId','duplicateOfDocumentId','calendarId'],
 sales:['documentId','estimateId','calendarId','sourceId'],
 payments:['saleId','documentId','bankTxnId'],
 calendarLinks:['saleId','cashSaleId','receiptSaleId','linkedInvoiceId','linkedReceiptId','googleEventId'],
 cashLedger:['linkedPaymentId','linkedExpenseId','linkedSupplierTransactionId'],
 supplierTransactions:['supplierId','bankTxnId'],
 bankTransactions:['matchId','paymentId']
});
const LINK_TARGETS=Object.freeze({
 documents:{saleId:'sales',paymentId:'payments',estimateId:'estimates',revisedFromDocumentId:'documents',duplicateOfDocumentId:'documents'},
 sales:{documentId:'documents',estimateId:'estimates'},
 payments:{saleId:'sales'},
 calendarLinks:{saleId:'sales',cashSaleId:'sales',receiptSaleId:'sales',linkedInvoiceId:'documents',linkedReceiptId:'documents'},
 cashLedger:{linkedPaymentId:'payments',linkedExpenseId:'expenses',linkedSupplierTransactionId:'supplierTransactions'},
 supplierTransactions:{supplierId:'suppliers'}
});
const clone=x=>JSON.parse(JSON.stringify(x));
function records(input){
 if(Array.isArray(input))return input;
 if(input&&typeof input==='object')return Object.values(input);
 return [];
}
function unwrap(entry,name){
 if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Invalid legacy '+name+' record');
 // Some backups expose records as {id,payload,revision}; others are the direct payload.
 const p=entry.payload&&typeof entry.payload==='object'&&!Array.isArray(entry.payload)?entry.payload:entry;
 return {id:entry.id||p.id||p[name.replace(/s$/,'')+'Id']||'',payload:p,revision:entry.revision??null};
}
function validateLegacyDump(dump,{strictCollections=true,strictLinks=false}={}){
 if(!dump||typeof dump!=='object'||Array.isArray(dump))throw Error('Legacy dump must be an object');
 const warnings=[],issues=[],inventory=[],unknown=[],index=Object.create(null);
 for(const key of Object.keys(dump)){
  if(!LEGACY_COLLECTIONS.includes(key))unknown.push(key);
 }
 if(strictCollections&&unknown.length)issues.push({severity:'block',code:'unknown-collection',collections:unknown});
 for(const name of LEGACY_COLLECTIONS){
  const source=records(dump[name]),mapping=MAPPING[name];
  const ids=new Set(),references=new Set(),fields=new Set();
  for(const [index,entry] of source.entries()){
   try{
    const value=unwrap(entry,name),id=value.id;
    if(!id){issues.push({severity:'block',collection:name,index,code:'missing-id'});continue;}
    if(ids.has(id)){issues.push({severity:'block',collection:name,id,code:'duplicate-id'});continue;}
    ids.add(id);
    Object.keys(value.payload).forEach(k=>fields.add(k));
    if(mapping.target===null&&mapping.mode==='blocked')issues.push({severity:'block',collection:name,id,code:'missing-new-domain'});
    for(const key of REQUIRED_LINKS[name]||[]){
     if(value.payload[key]!==undefined&&value.payload[key]!==null&&value.payload[key]!=='')references.add(key);
    }
    if(name==='documents'){
     if(value.payload.confirmed===true&&!value.payload.snapshot)issues.push({severity:'block',collection:name,id,code:'missing-formal-snapshot'});
     if(value.payload.snapshot?.invoiceNo&&value.payload.invoiceNo&&value.payload.snapshot.invoiceNo!==value.payload.invoiceNo)
      issues.push({severity:'block',collection:name,id,code:'number-mismatch'});
     if(value.payload.snapshot?.carryoverAmount&&value.payload.docType==='onoda')
      warnings.push({collection:name,id,code:'carryover-display-only',note:'小野田繰越は当月売上に含めない'});
    }
    if(name==='payments'&&value.payload.saleId&&!['cash-received','bank-confirmed','pending-bank'].includes(value.payload.confirmation||'pending-bank'))
      warnings.push({collection:name,id,code:'legacy-payment-status',confirmation:value.payload.confirmation});
   }catch(e){issues.push({severity:'block',collection:name,index,code:'invalid-record',message:e.message});}
  }
  index[name]=ids;
  inventory.push({legacyCollection:name,target:mapping.target,mode:mapping.mode,count:source.length,observedFields:[...fields].sort(),observedLinks:[...references],note:mapping.reason});
 }
 // Link checking is optional for partial exports; strict mode is required before migration.
 for(const [name,links] of Object.entries(LINK_TARGETS)){
  for(const entry of records(dump[name])){
   if(!entry||typeof entry!=='object')continue;
   const {id,payload}=unwrap(entry,name);
   for(const [field,target] of Object.entries(links)){
    const value=payload[field];if(!value||!index[target])continue;
    const targetCollectionIncluded=Object.prototype.hasOwnProperty.call(dump,target);
    if(!targetCollectionIncluded)continue; // report is partial; do not infer loss.
    if(!index[target].has(value)){
     const issue={collection:name,id,field,target,code:'missing-referenced-record',reference:String(value)};
     if(strictLinks)issues.push({severity:'block',...issue});
     else warnings.push(issue);
    }
   }
  }
 }
 return {sourceCommit:SOURCE_COMMIT,schemaVersion:2,readOnly:true,inventory,unknown,issues,warnings,
  canAutoMigrate:issues.length===0&&inventory.every(x=>x.count===0||x.mode==='safe-mapped')};
}
function compareSnapshots(original,after){
 const left=JSON.stringify(original),right=JSON.stringify(after);
 return {unchanged:left===right,oldBytes:left.length,newBytes:right.length};
}
return {SOURCE_COMMIT,LEGACY_COLLECTIONS,NEW_COLLECTIONS,LOCAL_KEYS,MAPPING,REQUIRED_LINKS,LINK_TARGETS,validateLegacyDump,compareSnapshots};
});
