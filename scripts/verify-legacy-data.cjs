/* Read-only local analyzer of an exported, anonymized geruninn collection dump.
 * No Firebase SDK, no writes, no customer data upload.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),C=require('../src/compat/legacy-contract');
function main(args){
 if(args.length!==1){console.error('Usage: npm run audit:legacy -- /absolute/path/to/anonymized-legacy-collections.json');return 64;}
 const file=path.resolve(args[0]);
 if(!file.endsWith('.json')){console.error('Only .json export files accepted');return 64;}
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=C.validateLegacyDump(data);
 const summary={
  sourceCommit:result.sourceCommit,readOnly:true,
  totalRecords:result.inventory.reduce((n,x)=>n+x.count,0),
  collections:result.inventory.map(x=>({name:x.legacyCollection,count:x.count,target:x.target,mode:x.mode,observedLinks:x.observedLinks})),
  blockingIssueCount:result.issues.length,warningCount:result.warnings.length,
  blockersByType:result.issues.reduce((o,x)=>(o[x.code]=(o[x.code]||0)+1,o),{}),
  canAutoMigrate:result.canAutoMigrate
 };
 console.log(JSON.stringify(summary,null,2));
 if(!result.canAutoMigrate){console.error('FAIL CLOSED: Migration is NOT authorized. Do not alter source data.');return 2;}
 return 0;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(e){console.error('Legacy audit error: '+e.message);process.exitCode=1;}}
module.exports={main};
