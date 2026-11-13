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
