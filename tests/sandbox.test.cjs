const {test}=require('node:test'),assert=require('node:assert/strict'),{createSandboxStore}=require('../src/storage/sandbox');
function storage(){
 const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
}
test('test store persists across openings without reset',async()=>{
 const mem=storage();const a=createSandboxStore({storage:mem});
 await a.perform({operationId:'one',type:'saveProject',customer:'顧客A'});
 const b=createSandboxStore({storage:mem});
 assert.equal(b.snapshot().collections.projects.project_000001.customer,'顧客A');
});
test('no global clear required: delete one test record after explicit confirmation',async()=>{
 const mem=storage(),a=createSandboxStore({storage:mem});
 await a.perform({operationId:'one',type:'saveProject',customer:'A'});
 await a.perform({operationId:'two',type:'saveProject',customer:'B'});
 await a.perform({operationId:'three',type:'deleteTestRecord',collection:'projects',id:'project_000001',confirmTestDeletion:true});
 const b=createSandboxStore({storage:mem});
 assert.equal(Object.keys(b.snapshot().collections.projects).length,1);
 assert.equal(Object.values(b.snapshot().collections.projects)[0].customer,'B');
});
test('failed action cannot alter stored data',async()=>{
 const mem=storage(),a=createSandboxStore({storage:mem});
 await a.perform({operationId:'one',type:'saveProject',customer:'A'});
 const before=mem.getItem(a.storageKey);
 await assert.rejects(a.perform({operationId:'bad',type:'saveExpense',vendor:'A',amount:'8.2',category:'雑費',paymentMethod:'現金',expenseDate:'2026-11-13'}));
 assert.equal(mem.getItem(a.storageKey),before);
});
test('external edits produce conflict instead of silent overwrite',async()=>{
 const mem=storage(),first=createSandboxStore({storage:mem}),second=createSandboxStore({storage:mem});
 await first.perform({operationId:'one',type:'saveProject',customer:'A'});
 await assert.rejects(second.perform({operationId:'two',type:'saveProject',customer:'B'}),/更新されました/);
});
test('backup is test-only and cannot replace existing data',async()=>{
 const mem=storage(),a=createSandboxStore({storage:mem});
 await a.perform({operationId:'one',type:'saveProject',customer:'A'});
 const backup=a.exportBackup(),newMem=storage(),b=createSandboxStore({storage:newMem});
 b.importBackup(backup);
 assert.equal(Object.keys(b.snapshot().collections.projects).length,1);
 assert.throws(()=>b.importBackup(backup),/既存テストデータ/);
});
