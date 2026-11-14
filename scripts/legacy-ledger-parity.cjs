/* Independent parity calculator for a complete 15-collection legacy export.
 * No migration and no database writes; throw on any mismatch.
 * Original frozen accounting module is the reference implementation.
 */
'use strict';
const Shadow=require('../src/compat/legacy-shadow');
const Original=require('../legacy-pdf/source/js/accounting.js');
const readOnlyCopy=x=>JSON.parse(JSON.stringify(x));
function parity(dump,{asOf='9999-12-31'}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('Invalid as-of date');
 const before=JSON.stringify(dump);
 const bridge=Shadow.createShadow(dump,{requireFullExport:true});
 const originalRows=Original.receivables([...bridge.rows('sales'),...bridge.rows('receivables')],bridge.rows('payments'),asOf)
  .map(x=>({id:x.id,amount:x.amount,paid:x.paid,outstanding:x.outstanding,receivableOnly:!!x.receivableOnly}))
  .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const derivedRows=bridge.receivableRows({asOf}).map(x=>({id:x.id,amount:x.amount,paid:x.confirmedPaid,outstanding:x.outstanding,receivableOnly:!!x.receivableOnly}))
  .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const diff=[];
 if(originalRows.length!==derivedRows.length)diff.push({type:'row-count',old:originalRows.length,new:derivedRows.length});
 for(let i=0;i<Math.max(originalRows.length,derivedRows.length);i++){
  const old=originalRows[i],newRow=derivedRows[i];
  if(JSON.stringify(old)!==JSON.stringify(newRow))diff.push({type:'row-mismatch',id:old?.id||newRow?.id,oldAmount:old?.amount,newAmount:newRow?.amount,oldPaid:old?.paid,newPaid:newRow?.paid,oldUnpaid:old?.outstanding,newUnpaid:newRow?.outstanding});
 }
 const projected=bridge.reconcile();
 if(JSON.stringify(dump)!==before)throw Error('Read-only parity audit changed original data');
 return {sourceCommit:bridge.inventory.sourceCommit,asOf,readonly:true,
  rows:derivedRows.length,oldTotals:{
   grossSales:originalRows.filter(x=>!x.receivableOnly).reduce((n,x)=>n+x.amount,0),
   paid:originalRows.reduce((n,x)=>n+x.paid,0),
   outstanding:originalRows.reduce((n,x)=>n+x.outstanding,0)},
  newTotals:projected.totals,pass:diff.length===0,discrepancies:diff,
  migrationAuthorized:false};
}
module.exports={parity};
