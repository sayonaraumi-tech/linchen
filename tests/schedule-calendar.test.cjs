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
