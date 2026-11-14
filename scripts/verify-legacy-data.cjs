/* Read-only local analyzer of an exported, anonymized geruninn collection dump.
 * No Firebase SDK, no writes, no customer data upload.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),C=require('../src/compat/legacy-contract');
const {parity}=require('./legacy-ledger-parity.cjs');
function main(args){
 if(args.length!==1){console.error('Usage: npm run audit:legacy -- /absolute/path/to/anonymized-legacy-collections.json');return 64;}
 const file=path.resolve(args[0]);
 if(!file.endsWith('.json')){console.error('Only .json export files accepted');return 64;}
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=C.validateLegacyDump(data,{strictLinks:true});
 const fullExport=C.LEGACY_COLLECTIONS.every(name=>Object.prototype.hasOwnProperty.call(data,name));
 let ledgerParity=null;
 if(fullExport){
  try{const p=parity(data,{asOf:'9999-12-31'});ledgerParity={pass:p.pass,asOf:p.asOf,rows:p.rows,oldTotals:p.oldTotals,newTotals:p.newTotals,differences:p.discrepancies.length};}
  catch{ledgerParity={pass:false,reason:'legacy-ledger-cannot-be-verified'};}
 }
 const summary={
  sourceCommit:result.sourceCommit,readOnly:true,
  totalRecords:result.inventory.reduce((n,x)=>n+x.count,0),
  collections:result.inventory.map(x=>({name:x.legacyCollection,count:x.count,target:x.target,mode:x.mode,observedLinks:x.observedLinks})),
  blockingIssueCount:result.issues.length,warningCount:result.warnings.length,
  blockersByType:result.issues.reduce((o,x)=>(o[x.code]=(o[x.code]||0)+1,o),{}),
  fullExport,ledgerParity,
  canAutoMigrate:false // audit is never a production migration authorization
 };
 console.log(JSON.stringify(summary,null,2));
 console.error('READ ONLY: Migration is never authorized by this tool. Do not alter source data.');
 return result.issues.length||!fullExport||ledgerParity?.pass!==true?2:0;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(e){console.error('Legacy audit error: '+e.message);process.exitCode=1;}}
module.exports={main};
