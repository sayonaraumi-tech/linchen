/* CSV -> evidence only. NEVER auto-create sales, payments, or expenses.
 * Support UTF-8 BOM and Shift_JIS as existing GMO exports require.
 */
const B=require('../core/business'),CSV=require('./bank-csv');
function decodeBytes(value,{encoding='auto'}={}){
 if(typeof value==='string')return value;
 const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
 if(encoding==='auto'){
  const bom=bytes.length>=3&&bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF;
  if(bom)return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{return new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}
 }
 if(!['utf-8','shift_jis'].includes(encoding))throw Error('文字コードを選択してください');
 return new TextDecoder(encoding,{fatal:true}).decode(bytes);
}
function importCSV(state,input,{account,accountAliases={},batchId='bank-import'}={}){
 if(!batchId||!account)throw Error('銀行口座名と取込IDが必要です');
 const parsed=CSV.parseCSV(decodeBytes(input),{account,accountAliases});
 if(parsed.errors.length)throw Error('銀行CSVに不正な行があります: '+parsed.errors.map(x=>'行'+x.line+' '+x.error).join('; '));
 const existing=B.list(state,'bankTransactions').map(x=>({
  identity:x.externalId,amount:x.amount,direction:x.direction,date:x.date,description:x.description
 }));
 const classified=CSV.inspectImport(existing,parsed.entries);
 let next=state;
 for(const entry of classified.accepted){
  const result=B.perform(next,{type:'importBankTransaction',operationId:batchId+'_'+entry.sourceRow+'_'+entry.occurrence,account:entry.account,externalId:entry.identity,date:entry.date,description:entry.description,amount:entry.amount,direction:entry.direction,balance:entry.balance,memo:entry.memo,occurrence:entry.occurrence,confidence:entry.confidence,rawDescription:entry.rawDescription});
  next=result.state;
 }
 return {state:next,summary:{imported:classified.accepted.length,duplicates:classified.duplicates.length,requiresReview:classified.review.length,errors:parsed.errors},review:classified.review.map(x=>({sourceRow:x.sourceRow,description:x.description,amount:x.amount,reason:x.reason}))};
}
module.exports={decodeBytes,importCSV};
