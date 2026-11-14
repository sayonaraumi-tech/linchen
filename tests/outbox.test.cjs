const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOutbox,keyFor}=require('../src/storage/outbox');
function mem(){let d=new Map();return {getItem:k=>d.get(k)||null,setItem:(k,v)=>d.set(k,v),removeItem:k=>d.delete(k)};}
const setup=(storage,send,uid='u1')=>createOutbox({storage,projectId:'demo',companyId:'tsukinowa',uid,send});
test('offline queue survives reopened session and retries same operation only once',async()=>{
 const st=mem(),cmd={operationId:'op1',type:'saveDocument',payload:{customer:'A'}};
 const first=setup(st,async()=>{throw Error('offline')});first.enqueue(cmd);
 const fail=await first.flush();assert.equal(fail.pending,1);assert.equal(fail.blocked,false);
 let sends=0;const second=setup(st,async()=>{sends++});
 assert.equal(second.snapshot().length,1);
 assert.equal((await second.flush()).processed,1);assert.equal(sends,1);assert.equal(second.snapshot().length,0);
});
test('same operationId with different contents is refused',()=>{
 const st=mem(),q=setup(st,async()=>{});
 q.enqueue({operationId:'same',type:'save'});
 assert.throws(()=>q.enqueue({operationId:'same',type:'delete'}),/操作ID/);
});
test('blocked revision conflict must be explicitly archived with reason',async()=>{
 const st=mem(),q=setup(st,async()=>{throw Error('版数競合')});
 q.enqueue({operationId:'op1',type:'save'});
 q.enqueue({operationId:'op2',type:'save'});
 const result=await q.flush();assert.equal(result.blocked,true);
 assert.equal(q.snapshot()[0].status,'blocked');assert.equal(q.snapshot().length,2);
 assert.throws(()=>q.archiveBlocked('op1',{}),/理由/);
 q.archiveBlocked('op1',{reason:'customer resolved after backup'});
 assert.equal(q.snapshot().length,1);
 assert(q.exportRecovery().includes('customer resolved after backup'));
});
test('separate users and projects never share offline outboxes',()=>{
 assert.notEqual(keyFor('projectA','co','u'),keyFor('projectB','co','u'));
 assert.notEqual(keyFor('projectA','co','u'),keyFor('projectA','co','other'));
});
test('failed persistent storage prevents enqueue confirmation',()=>{
 const st={getItem:()=>null,setItem:()=>{throw Error('quota')}},q=setup(st,async()=>{});
 assert.throws(()=>q.enqueue({operationId:'op',type:'save'}),/quota/);
 assert.equal(q.snapshot().length,0);
});
