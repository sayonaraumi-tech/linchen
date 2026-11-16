const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business'),C=require('../src/core/schedule-calendar');
const run=(s,id,c)=>B.perform(s,{operationId:id,...c}).state;
test('internal monthly calendar works without any Google connection',()=>{
 let s=B.emptyState();s=run(s,'ev',{type:'saveSchedule',date:'2026-11-16',title:'壁紙張替',customer:'A社'});
 const cal=C.calendarMonth(s,'2026-11');
 assert.equal(cal.events.length,1);
 assert.equal(cal.events[0].origin,'internal');
 assert(cal.cells.find(x=>x.date==='2026-11-16').events.some(x=>x.title==='壁紙張替'));
 assert.equal(cal.cells.length%7,0);
});
test('existing sale and document attach to same calendar event once',()=>{
 let s=B.emptyState();s=run(s,'event',{type:'saveSchedule',date:'2026-11-16',title:'クロス工事',customer:'A'});
 const id=B.list(s,'schedule')[0].id;
 s=run(s,'sale',{type:'registerScheduleSale',scheduleId:id,amount:11000});
 s=run(s,'invoice',{type:'issueDocument',docType:'invoice',scheduleId:id,sourceKey:'invoice1',amount:11000,snapshot:{customerName:'A',invoiceDate:'2026-11-16',items:[{content:'工事',qty:1,price:10000}]}});
 const items=C.internalEvents(s,'2026-11');assert.equal(items.length,1);
 assert.equal(items[0].amount,11000);assert.equal(items[0].status,'売上登録済');assert.equal(items[0].documentIds.length,1);
});
test('Google-linked items appear in the same internal calendar with no duplicate',()=>{
 let s=B.emptyState();
 s=run(s,'google',{type:'saveSchedule',id:'google-1',date:'2026-11-17',title:'現地調査',googleEventId:'g1',calendarId:'cal1'});
 assert.equal(C.calendarMonth(s,'2026-11').events.length,1);
 assert.equal(C.calendarMonth(s,'2026-11').events[0].origin,'google-linked');
});
test('voided schedules disappear but historical documents remain available separately',()=>{
 let s=B.emptyState();s=run(s,'event',{type:'saveSchedule',date:'2026-11-17',title:'工事'});
 const id=B.list(s,'schedule')[0].id;
 s=run(s,'void',{type:'voidRecord',collection:'schedule',id,reason:'取消'});
 assert.equal(C.calendarMonth(s,'2026-11').events.length,0);
});

test('Onoda draft includes only selected same-month schedules and preserves the source IDs',()=>{
 let s=B.emptyState();
 const schedule=(id,date,kind,onodaQuantity)=>({
  type:'saveSchedule',id,date,kind,onodaQuantity,title:'クロス張替',description:'現場備考',
 });
 s=run(s,'one',schedule('selected','2026-11-12','小野田',8.5));
 s=run(s,'two',schedule('missing','2026-11-18','小野田',null));
 s=run(s,'three',schedule('other-month','2026-12-02','小野田',2));
 s=run(s,'four',schedule('other-kind','2026-11-10','見積',null));
 const args={month:'2026-11',selectedIds:['selected'],invoiceDate:'2026-11-30',
  billing:{customerName:'検証取引先',unitPrice:830,taxable:false}};
 const Calendar=require('../src/core/schedule-calendar');
 const before=JSON.stringify(s);
 assert.deepEqual(Calendar.onodaCandidates(s,'2026-11').map(x=>x.id),['selected','missing']);
 const draft=Calendar.draftOnodaInvoice(s,args);
 assert.deepEqual(draft.items,[{content:'クロス張替',qty:8.5,unit:'m',price:830,taxable:false,
  sourceEventId:'selected',workDate:'2026-11-12',memo:'現場備考'}]);
 assert.equal(draft.invoiceNo,undefined);
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>Calendar.draftOnodaInvoice(s,{...args,selectedIds:['missing']}),/施工数量/);
 assert.throws(()=>Calendar.draftOnodaInvoice(s,{...args,selectedIds:['other-month']}),/読み込み直し/);
 assert.throws(()=>Calendar.draftOnodaInvoice(s,{...args,selectedIds:['selected','selected']}),/重複/);
 assert.throws(()=>Calendar.draftOnodaInvoice(s,{...args,billing:undefined}),/設定/);
});
