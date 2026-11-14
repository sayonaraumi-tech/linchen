/* Strictly ephemeral in-memory integration adapter. NEVER connects to Firebase production. */
(function(root){
"use strict";
let callback=null;
const records=new Map();
const driver={
  initialize:async()=>{},
  observeAuth:f=>(callback=f,()=>{callback=null}),
  claims:async u=>u.claims,
  digest:async value=>{
    const bytes=new TextEncoder().encode(String(value));
    const hashed=await crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(hashed)).map(v=>v.toString(16).padStart(2,"0")).join("");
  },
  timestamp:()=>Date.now(),
  list:async path=>[...records].filter(([p])=>p.startsWith(path+"/")).map(([p,v])=>({id:p.split("/").at(-1),...structuredClone(v)})),
  transaction:async fn=>{
    const staged=[],reader={
      get:async p=>structuredClone(records.get(p)||null),
      set:(p,v)=>staged.push([p,structuredClone(v)])
    };
    const result=await fn(reader);
    for(const [p,v] of staged)records.set(p,v);
    return result;
  }
};
let service=null,started=null,counter=0;
async function start(){
  if(started)return started;
  started=(async()=>{
    if(!root.TsukinowaCloudCore||!root.TsukinowaBusiness)throw Error("Original domain modules not loaded");
    const client=root.TsukinowaCloudCore.createClient(driver);
    await client.start({enabled:true,companyId:"tsukinowa",firebase:{apiKey:"DEMO_ONLY",authDomain:"localhost",projectId:"demo-tsukinowa",appId:"demo"}});
    if(!callback)throw Error("Sandbox auth callback missing");
    await callback({uid:"sandbox-admin",claims:{role:"admin",companyId:"tsukinowa"}});
    service=root.TsukinowaBusiness.createService(client);
    return true;
  })();
  return started;
}
const counts=()=>Object.fromEntries(["sales","payments","cashLedger","documents","calendarLinks","auditLogs"].map(n=>[n,[...records.keys()].filter(p=>p.startsWith("companies/tsukinowa/"+n+"/")).length]));
async function createCashReceipt(){
  await start();
  const documentId="sandbox-receipt-"+(++counter);
  const result=await service.execute({
    type:"saveDocument",
    operationId:"sandbox-op-"+documentId,
    expectedRevision:0,
    snapshot:{
      documentId,
      docType:"receipt",
      customerName:"検証用取引先",
      receiptTotal:"1000",
      invoiceDate:"2026-11-14",
      paymentMethod:"現金",
      tadashi:"動作検証",
      remarks:"隔離テスト環境のみ"
    }
  });
  return {result,counts:counts()};
}
root.TsukinowaSandbox=Object.freeze({start,createCashReceipt,counts});
})(globalThis);
