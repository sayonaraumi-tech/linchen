/* Read-only finance projections; no UI and no source mutations. */
const B=require('./business');
const active=r=>!r.deletedAt&&r.status!=='void'&&r.status!=='cancelled';
const yyyyMM=x=>String(x||'').slice(0,7);
function period(value){
 if(!value)return {from:'0000-01-01',to:'9999-12-31'};
 if(value.month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month))throw Error('対象月が不正です');return {from:value.month+'-01',to:value.month+'-31'};}
 if(value.fiscalYear){const y=Number(value.fiscalYear);if(!Number.isInteger(y)||y<2000||y>2100)throw Error('年度が不正です');return {from:y+'-10-01',to:(y+1)+'-09-30'};}
 const from=value.from||'0000-01-01',to=value.to||'9999-12-31';
 if(from>to)throw Error('期間を確認してください');return {from,to};
}
function included(date,p){return !!date&&date>=p.from&&date<=p.to;}
function amount(x){return Number(x.amount)||0;}
function salesRegister(s,p={}){
 const window=period(p),pay=B.list(s,'payments').filter(active);
 return B.list(s,'sales').filter(active).filter(x=>included(x.salesDate,window)).map(x=>{
  const paid=pay.filter(y=>y.saleId===x.id&&['bank-confirmed','cash-received'].includes(y.confirmation)).reduce((n,y)=>n+amount(y),0);
  return {id:x.id,customer:x.customer,salesDate:x.salesDate,invoiceDate:x.invoiceDate,description:x.description,sales:amount(x),paid,outstanding:amount(x)-paid,status:paid===0?'未入金':paid===amount(x)?'入金済':paid<amount(x)?'一部入金':'要確認'};
 }).sort((a,b)=>a.salesDate.localeCompare(b.salesDate)||a.id.localeCompare(b.id));
}
function paymentsRegister(s,p={}){
 const w=period(p);return B.list(s,'payments').filter(active).filter(x=>included(x.paymentDate,w)).map(x=>({id:x.id,saleId:x.saleId,paymentDate:x.paymentDate,amount:amount(x),method:x.method,confirmation:x.confirmation,bankTxnId:x.bankTxnId||''})).sort((a,b)=>a.paymentDate.localeCompare(b.paymentDate)||a.id.localeCompare(b.id));
}
function expensesRegister(s,p={}){
 const w=period(p);return B.list(s,'expenses').filter(active).filter(x=>included(x.expenseDate,w)).map(x=>({id:x.id,expenseDate:x.expenseDate,vendor:x.vendor,description:x.description,category:x.category,amount:amount(x),paymentMethod:x.paymentMethod,bankTxnId:x.bankTxnId||''})).sort((a,b)=>a.expenseDate.localeCompare(b.expenseDate)||a.id.localeCompare(b.id));
}
function cashRegister(s,p={}){
 const w=period(p);let balance=0;
 return B.list(s,'cashLedger').filter(active).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(x=>{
  balance+=(x.type==='income'?1:-1)*amount(x);
  return {...x,runningBalance:balance};
 }).filter(x=>included(x.date,w));
}
function bankQueue(s){
 return B.list(s,'bankTransactions').filter(active).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(x=>({id:x.id,account:x.account,date:x.date,description:x.description,amount:amount(x),direction:x.direction,status:x.status,matchType:x.matchType,matchId:x.matchId}));
}
function documentsHistory(s,type){
 return B.list(s,'documents').filter(x=>!type||x.docType===type).sort((a,b)=>a.issueDate.localeCompare(b.issueDate)||a.id.localeCompare(b.id));
}
function dashboard(s,p={}){
 const window=period(p);
 const sales=salesRegister(s,p),expenses=expensesRegister(s,p);
 const confirmed=paymentsRegister(s,p).filter(x=>['bank-confirmed','cash-received'].includes(x.confirmation));
 const cash=cashRegister(s,p);
 return {
  period:window,sales:sales.reduce((v,x)=>v+x.sales,0),
  receipts:confirmed.reduce((v,x)=>v+x.amount,0),
  expenses:expenses.reduce((v,x)=>v+x.amount,0),
  outstanding:sales.reduce((v,x)=>v+x.outstanding,0),
  cashIncome:cash.filter(x=>x.type==='income').reduce((v,x)=>v+x.amount,0),
  cashExpense:cash.filter(x=>x.type==='expense').reduce((v,x)=>v+x.amount,0),
  salesCount:sales.length,expensesCount:expenses.length,unmatchedBank:bankQueue(s).filter(x=>x.status==='unmatched').length
 };
}
function csvEscape(value){const raw=String(value??'');const safe=/^[\s]*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}
function exportCSV(headers,rows){return '\uFEFF'+[headers,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n')+'\r\n';}
function exportSalesCSV(s,p){return exportCSV(['売上日','取引先','内容','売上','入金済','未入金','状態'],salesRegister(s,p).map(x=>[x.salesDate,x.customer,x.description,x.sales,x.paid,x.outstanding,x.status]));}
function exportExpensesCSV(s,p){return exportCSV(['支出日','取引先','科目','内容','金額','支払方法'],expensesRegister(s,p).map(x=>[x.expenseDate,x.vendor,x.category,x.description,x.amount,x.paymentMethod]));}
module.exports={period,salesRegister,paymentsRegister,expensesRegister,cashRegister,bankQueue,documentsHistory,dashboard,exportCSV,exportSalesCSV,exportExpensesCSV};
