/* Internal calendar is a projection of owned schedule records, never a Google view.
 * No Google token, OAuth, network or import is needed to use it.
 */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./business'):root.TsukinowaCoreBusiness);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaScheduleCalendar=api;})(globalThis,function(B){
'use strict';
const validMonth=m=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)))throw Error('年月はYYYY-MM形式です');return m;};
const alive=x=>!x.deletedAt&&!['void','cancelled'].includes(x.status);
function internalEvents(state,month){
 validMonth(month);
 const schedules=B.list(state,'schedule').filter(alive);
 const sales=B.list(state,'sales').filter(alive);
 const docs=B.list(state,'documents').filter(alive);
 const result=[];
 for(const ev of schedules.filter(x=>x.date?.startsWith(month))){
  const relatedSales=sales.filter(s=>s.scheduleId===ev.id);
  const relatedDocs=docs.filter(d=>d.scheduleId===ev.id||relatedSales.some(s=>s.id===d.saleId));
  result.push({
   id:ev.id,date:ev.date,title:ev.title,customer:ev.customer||'',description:ev.description||'',
   start:ev.start||'',end:ev.end||'',status:ev.googleStatus==='cancelled'?'外部取消・要確認':ev.registeredSaleId?'売上登録済':'予定',
   amount:relatedSales.reduce((sum,s)=>sum+s.amount,0),
   saleIds:relatedSales.map(s=>s.id),documentIds:[...new Set(relatedDocs.map(d=>d.id))],
   origin:ev.googleEventId?'google-linked':'internal',googleEventId:ev.googleEventId||'',
   needsReview:ev.googleStatus==='cancelled',
  });
 }
 // A sale without a linked internal schedule should remain visible exactly once
 for(const sale of sales.filter(x=>x.salesDate?.startsWith(month)&&!x.scheduleId)){
  if(sale.sourceId?.startsWith('receipt:'))continue; // receipts alone are not construction schedules
  result.push({id:'sale:'+sale.id,date:sale.salesDate,title:sale.description||sale.customer||'登録売上',
   customer:sale.customer||'',description:sale.description||'',start:'',end:'',status:'売上登録済',amount:sale.amount,
   saleIds:[sale.id],documentIds:docs.filter(d=>d.saleId===sale.id).map(d=>d.id),origin:'sales-only',googleEventId:'',needsReview:false});
 }
 return result.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
function calendarMonth(state,month,{weekStartsOn=0}={}){
 validMonth(month);
 if(![0,1].includes(weekStartsOn))throw Error('週の開始曜日が不正です');
 const [year,m]=month.split('-').map(Number);
 const first=new Date(Date.UTC(year,m-1,1)),days=new Date(Date.UTC(year,m,0)).getUTCDate();
 const leading=(first.getUTCDay()-weekStartsOn+7)%7;
 const end=leading+days,cellCount=Math.ceil(end/7)*7;
 const events=internalEvents(state,month);
 const groups=new Map();
 for(const e of events){const key=e.date;groups.set(key,[...(groups.get(key)||[]),e]);}
 const cells=Array.from({length:cellCount},(_,i)=>{
  const day=i-leading+1;
  const date=new Date(Date.UTC(year,m-1,day)).toISOString().slice(0,10);
  return {date,day:Number(date.slice(8)),inMonth:day>=1&&day<=days,
   dayOfWeek:(i+weekStartsOn)%7,events:groups.get(date)||[]};
 });
 return {month,weekStartsOn,cells,events};
}
return {internalEvents,calendarMonth};
});
