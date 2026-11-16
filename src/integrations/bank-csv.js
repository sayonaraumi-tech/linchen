/* Pure parsing and identity of bank evidence. No automatic booking.
 * Stable identity must be based on actual bank evidence, never amount alone.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaBankCSV=api;})(globalThis,function(){
'use strict';
const normalize=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const date=v=>{
 const s=normalize(v);let m=s.match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?$/);
 if(!m)throw Error('日付の形式が不正です: '+s);
 const d=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
 if(new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('存在しない日付: '+s);
 return d;
};
const money=(value,required=false)=>{
 const s=normalize(value).replace(/[¥￥,\s円]/g,'');if(!s&&!required)return 0;
 if(!/^\d+$/.test(s))throw Error('金額の形式が不正です: '+String(value));
 const n=Number(s);if(!Number.isSafeInteger(n))throw Error('金額が大きすぎます');return n;
};
function parseRows(input){
 const s=String(input??'').replace(/^\uFEFF/,'');let rows=[],row=[],value='',quoted=false;
 for(let i=0;i<s.length;i++){
  const ch=s[i];if(ch==='"'){if(quoted&&s[i+1]==='"'){value+='"';i++;}else if(!quoted&&value.trim()){throw Error('CSV引用符が不正です');}else quoted=!quoted;}
  else if(ch===','&&!quoted){row.push(value);value='';}
  else if((ch==='\r'||ch==='\n')&&!quoted){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(value);if(row.some(x=>x.trim()))rows.push(row);row=[];value='';}
  else value+=ch;
 }
 if(quoted)throw Error('CSV引用符が閉じられていません');
 row.push(value);if(row.some(x=>x.trim()))rows.push(row);
 return rows;
}
const HEADERS={
 date:['日付','取引日','取引年月日','date'],
 description:['摘要','内容','取引内容','description'],
 incoming:['入金','入金額','入金金額','deposit'],
 outgoing:['出金','出金額','出金金額','withdrawal'],
 balance:['残高','取引後残高','balance'],
 memo:['メモ','備考','memo'],
 transactionId:['取引番号','取引id','取引id番号','transactionid','id']
};
function headerIndex(row,name){
 const options=HEADERS[name].map(normalize).map(x=>x.toLowerCase());
 return row.findIndex(v=>options.includes(normalize(v).toLowerCase()));
}
function parseCSV(content,{account,accountAliases={}}={}){
 if(!account||!normalize(account))throw Error('銀行口座名が必要です');
 const rows=parseRows(content),head=rows.findIndex(r=>['date','description','incoming','outgoing'].every(k=>headerIndex(r,k)>=0));
 if(head<0)throw Error('必要な銀行CSVヘッダーがありません');
 const indices=Object.fromEntries(Object.keys(HEADERS).map(k=>[k,headerIndex(rows[head],k)]));
 const canonical=normalize(accountAliases[normalize(account)]||account);
 const signatures=new Map(),entries=[],errors=[];
 for(let i=head+1;i<rows.length;i++){
  const columns=rows[i];if(columns.every(x=>!normalize(x)))continue;
  const cell=k=>indices[k]<0?'':columns[indices[k]]??'';
  try{
   const dateValue=date(cell('date')),description=normalize(cell('description'));
   const incoming=money(cell('incoming')),outgoing=money(cell('outgoing'));
   if(!description)throw Error('摘要がありません');
   if((incoming>0)===(outgoing>0))throw Error('入金または出金のいずれか一方に金額が必要です');
   const balance=cell('balance').trim()===''?null:money(cell('balance'));
   const bankId=normalize(cell('transactionId')),direction=incoming?'income':'outgoing',amount=incoming||outgoing;
   const signature=[canonical,dateValue,description,direction,amount,balance===null?'':balance].join('|');
   const occurrence=(signatures.get(signature)||0)+1;signatures.set(signature,occurrence);
   const identity=bankId?'id|'+canonical+'|'+bankId:'evidence|'+signature+'|'+occurrence;
   entries.push({account:canonical,rawAccount:account,date:dateValue,description,rawDescription:cell('description'),memo:cell('memo'),incoming,outgoing,amount,direction,balance,bankId,occurrence,identity,confidence:bankId?'strong':balance!==null?'balance-backed':'review',sourceRow:i+1});
  }catch(e){errors.push({line:i+1,error:e.message});}
 }
 return {account:canonical,entries,errors,headerLine:head+1};
}
function inspectImport(existing,newRows){
 const known=new Map(existing.map(r=>[r.identity,r])),accepted=[],duplicates=[],review=[];
 for(const row of newRows){
  const old=known.get(row.identity);
  if(old){
   if(old.amount!==row.amount||old.direction!==row.direction||old.date!==row.date||normalize(old.description)!==normalize(row.description))
    throw Error('銀行明細IDは同じですが取引内容が異なります: '+row.identity);
   duplicates.push({incoming:row,original:old});continue;
  }
  if(row.confidence==='review')review.push({...row,reason:'取引番号・残高がなく、部分CSV間の重複を確定できません'});
  accepted.push(row);known.set(row.identity,row);
 }
 return {accepted,duplicates,review};
}
function matchCandidates(bank,{payments=[],expenses=[]}={}){
 const p=payments.filter(x=>!x.deletedAt&&!x.bankTxnId&&x.confirmation==='pending-bank'&&x.amount===bank.amount);
 const e=expenses.filter(x=>!x.deletedAt&&!x.bankTxnId&&x.paymentMethod!=='現金'&&x.amount===bank.amount);
 const choices=(bank.direction==='income'?p:e).map(r=>({kind:bank.direction==='income'?'payment':'expense',id:r.id,reason:'金額一致（要確認）'}));
 return {status:choices.length?'候補あり':'未一致',candidates:choices,autoConfirmed:false};
}
return {parseRows,parseCSV,inspectImport,matchCandidates};
});
