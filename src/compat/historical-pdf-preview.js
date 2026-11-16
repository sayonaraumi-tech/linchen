/* Historical-PDF compatibility: original parser + duplicate rules, read-only.
 * A preview NEVER issues a formal document or generates sales/receivables.
 */
'use strict';
const Original=require('../../legacy-pdf/source/js/historical-import.js');
function previewHistoricalPdf({text='',draft=null,documents=[],sales=[],sourceHash=''}={}){
 if(sourceHash&&!/^[a-f0-9]{64}$/.test(String(sourceHash)))throw Error('原本SHA-256を確認してください');
 const candidate=draft||Original.parseText(text);
 const valid=Original.validate(candidate);
 const checked=Original.check(valid,documents,sales,sourceHash);
 return {
  draft:JSON.parse(JSON.stringify(valid)),sourceHash,
  status:checked.duplicate?'duplicate':checked.matches.length===1?'link-review':
   checked.matches.length>1?'ambiguous':'unlinked-review',
  duplicateId:checked.duplicate?.id||checked.duplicate?.documentId||'',
  matchingSaleIds:checked.matches.map(x=>x.id||x.payload?.id||'').filter(Boolean),
  action:'read-only',
  createSale:false,issueNewNumber:false,automaticWrites:0
 };
}
module.exports={previewHistoricalPdf};
