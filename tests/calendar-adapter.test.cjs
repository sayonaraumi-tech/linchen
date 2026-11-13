const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const B=require('../src/core/business'),C=require('../src/integrations/calendar-sync');
const hash=x=>Promise.resolve(crypto.createHash('sha256').update(x).digest('hex'));
const event=(title='工事日程')=>({id:'g123',summary:title,start:{date:'2026-11-16'},end:{date:'2026-11-17'},updated:'2026-11-12T00:00:00Z',status:'confirmed'});
test('Calendar import retains single stable schedule id and avoids duplicate on repeated sync',async()=>{
 let s=B.emptyState();const first=await C.applyIncoming(s,{calendarId:'calendarA',events:[event()],digest:hash});
 assert.deepEqual(first.summary,{added:1,updated:0,skipped:0,cancelled:0});s=first.state;
 const second=await C.applyIncoming(s,{calendarId:'calendarA',events:[event()],digest:hash});
 assert.equal(second.summary.skipped,1);assert.equal(B.list(second.state,'schedule').length,1);
});
test('later Google changes do not overwrite accounting and registered sale',async()=>{
 let s=(await C.applyIncoming(B.emptyState(),{calendarId:'calendarA',events:[event()],digest:hash})).state;
 const id=B.list(s,'schedule')[0].id;
 s=B.perform(s,{operationId:'cash',type:'registerScheduleSale',scheduleId:id,amount:11000}).state;
 const incoming={...event('工事変更'),updated:'2026-11-13T00:00:00Z',description:'外部テキスト'};
 s=(await C.applyIncoming(s,{calendarId:'calendarA',events:[incoming],digest:hash})).state;
 assert.equal(B.list(s,'schedule')[0].registeredSaleId,B.list(s,'sales')[0].id);
 assert.equal(B.list(s,'sales').length,1);
 assert.equal(B.list(s,'schedule')[0].title,'工事変更');
 assert.equal(B.list(s,'schedule')[0].description,'外部テキスト');
});
test('stale changes ignored and cancellation never physically deletes a business schedule',async()=>{
 let s=(await C.applyIncoming(B.emptyState(),{calendarId:'c',events:[event()],digest:hash})).state;
 const stale={...event('古い'),updated:'2026-01-01T00:00:00Z'};
 const after=await C.applyIncoming(s,{calendarId:'c',events:[stale],digest:hash});
 assert.equal(after.summary.skipped,1);s=after.state;
 const cancel=await C.applyIncoming(s,{calendarId:'c',events:[{...event(),status:'cancelled',updated:'2026-11-17T00:00:00Z'}],digest:hash,allowCancelled:true});
 assert.equal(B.list(cancel.state,'schedule').length,1);
 assert.equal(B.list(cancel.state,'schedule')[0].googleStatus,'cancelled');
});
test('pagination collects all pages without duplicate request loops',async()=>{
 const calls=[];
 const data=await C.collectPages(async({pageToken})=>{calls.push(pageToken);return pageToken?{items:[event('second')]}:{items:[event('first')],nextPageToken:'p2'};},{calendarId:'c'});
 assert.equal(data.length,2);assert.deepEqual(calls,[null,'p2']);
});
test('ETag conflict returns explicit review instead of retrying destructive overwrite',async()=>{
 const r=await C.patchLinkedEvent({calendarId:'c',eventId:'e',etag:'old',description:'abc',summary:'修正',provider:{patch:async()=>{const e=new Error('Precondition Failed');e.status=412;throw e;}}});
 assert.equal(r.status,'conflict');assert.equal(r.requiresReview,true);
});

test('internal schedule Google create and later update are optional and preserve the local record',async()=>{
 let s=B.emptyState();s=B.perform(s,{operationId:'local1',type:'saveSchedule',date:'2026-11-16',title:'内装工事',customer:'A'}).state;
 const original=B.list(s,'schedule')[0],calls=[];
 const api={
  insert:async arg=>{calls.push('insert');return {id:arg.id,etag:'v1',updated:'2026-11-13T00:00:00Z'};},
  patch:async arg=>{calls.push('patch');return {id:arg.eventId,etag:'v2',updated:'2026-11-14T00:00:00Z'};},
  get:async()=>null,
 };
 const first=await C.pushInternalEvent({schedule:original,calendarId:'test-calendar',provider:api,digest:hash});
 assert.equal(first.status,'synced');assert.equal(calls.length,1);
 assert.equal(B.list(s,'schedule')[0].googleEventId,''); // local state unmodified by Google
 s=B.perform(s,first.command).state;
 const linked=B.list(s,'schedule')[0];
 assert.equal(linked.googleEventId,first.eventId);
 const second=await C.pushInternalEvent({schedule:linked,calendarId:'test-calendar',provider:api,digest:hash});
 assert.equal(second.status,'synced');assert.deepEqual(calls,['insert','patch']);
 s=B.perform(s,second.command).state;
 assert.equal(B.list(s,'schedule').length,1);assert.equal(B.list(s,'schedule')[0].customer,'A');
});
test('Google connection outage does not destroy an internal schedule',async()=>{
 let s=B.emptyState();s=B.perform(s,{operationId:'local2',type:'saveSchedule',date:'2026-11-16',title:'クロス工事'}).state;
 const before=JSON.stringify(s);
 const result=await C.pushInternalEvent({schedule:B.list(s,'schedule')[0],calendarId:'test-calendar',digest:hash,
  provider:{insert:async()=>{throw new Error('offline')},patch:async()=>{},get:async()=>{}}});
 assert.equal(result.status,'pending');assert.equal(result.retryable,true);
 assert.equal(JSON.stringify(s),before);
});
test('Google create conflict resolves only matching deterministic event',async()=>{
 let s=B.emptyState();s=B.perform(s,{operationId:'local3',type:'saveSchedule',date:'2026-11-16',title:'クロス工事'}).state;
 const api={insert:async()=>{let e=new Error('already exists');e.status=409;throw e;},patch:async()=>{},get:async({eventId})=>({id:eventId,etag:'already',extendedProperties:{private:{tsukinowaScheduleId:B.list(s,'schedule')[0].id}}})};
 const r=await C.pushInternalEvent({schedule:B.list(s,'schedule')[0],calendarId:'test-calendar',provider:api,digest:hash});
 assert.equal(r.status,'synced');assert.equal(r.googleEtag,'already');
});

test('Google 409 collision is not silently adopted without exact originating schedule marker',async()=>{
 let s=B.emptyState();s=B.perform(s,{type:'saveSchedule',operationId:'private-cal',date:'2026-11-16',title:'クロス工事'}).state;
 const api={insert:async()=>{const e=new Error('conflict');e.status=409;throw e;},
   patch:async()=>{},get:async({eventId})=>({id:eventId,etag:'someone-else'})};
 const before=JSON.stringify(s);
 const r=await C.pushInternalEvent({schedule:B.list(s,'schedule')[0],calendarId:'test-calendar',provider:api,digest:hash});
 assert.equal(r.status,'requires-review');
 assert.equal(JSON.stringify(s),before);
});
test('remote day change for booked construction schedule is retained as review, not silently changed',async()=>{
 let s=(await C.applyIncoming(B.emptyState(),{calendarId:'c',events:[event()],digest:hash})).state;
 const sid=B.list(s,'schedule')[0].id;
 s=B.perform(s,{type:'registerScheduleSale',operationId:'booked',scheduleId:sid,amount:11000}).state;
 const first=JSON.stringify(B.list(s,'sales'));
 const remote={...event('更新内容'),start:{date:'2026-11-19'},end:{date:'2026-11-20'},updated:'2026-11-19T00:00:00Z'};
 const res=await C.applyIncoming(s,{calendarId:'c',events:[remote],digest:hash});
 assert.equal(res.summary.skipped,1);
 assert.equal(B.list(res.state,'schedule')[0].date,'2026-11-16');
 assert.equal(JSON.stringify(B.list(res.state,'sales')),first);
 assert.equal(res.state.calendarConflicts.length,1);
 assert.equal(res.state.calendarConflicts[0].incomingDate,'2026-11-19');
});
