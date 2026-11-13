/* Google Calendar boundary. No OAuth secrets and no writes to Google on import.
 * A formal document snapshot, sale, and payment must never be overwritten
 * by a remote calendar description.
 */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../core/business'):root.TsukinowaCoreBusiness);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaCalendarAdapter=api;})(globalThis,function(B){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const normalize=v=>String(v??'').trim();
function isoDay(v){let s=normalize(v);if(!s)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);if(Number.isNaN(d.valueOf()))throw Error('Invalid calendar date');return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function parseGoogleEvent(calendarId,e){
 const eventId=normalize(e?.id||e?.googleEventId);
 if(!eventId||!calendarId)throw Error('GoogleイベントIDとカレンダーIDが必要です');
 const start=e.start?.dateTime||e.start?.date||e.start||e.date;
 const end=e.end?.dateTime||e.end?.date||e.end||'';
 const date=isoDay(start);
 if(!date)throw Error('Googleイベントに日付がありません');
 return {calendarId,eventId,date,start:typeof start==='string'?start:'',end:typeof end==='string'?end:'',title:normalize(e.summary||e.title)||'予定',description:normalize(e.description),location:normalize(e.location),etag:normalize(e.etag),updated:normalize(e.updated),status:normalize(e.status)||'confirmed'};
}
const irrelevant=e=>/^(?:祝日|振替休日|国民の休日|休暇|休み|定休日|holiday|rest day)$/i.test(normalize(e.title))||e.status==='deleted';
function originalLink(state,event){
 return B.list(state,'schedule').find(r=>r.googleEventId===event.eventId&&r.calendarId===event.calendarId);
}
function eventIdentity(event){return event.calendarId+'|'+event.eventId;}
async function applyIncoming(state,{calendarId,events,digest,allowCancelled=false}){
 if(!Array.isArray(events)||typeof digest!=='function')throw Error('Calendar events and digest are required');
 let next=clone(state),added=0,updated=0,skipped=0,cancelled=0;
 for(const raw of events){
  const ev=parseGoogleEvent(calendarId,raw);
  if(irrelevant(ev)){skipped++;continue;}
  const old=originalLink(next,ev);
  if(ev.status==='cancelled'){
   cancelled++;
   if(!allowCancelled||!old){skipped++;continue;}
  }
  if(old?.googleUpdatedAt&&ev.updated&&ev.updated<old.googleUpdatedAt){skipped++;continue;}
  if(old&&old.date===ev.date&&old.title===ev.title&&old.description===ev.description&&old.location===ev.location&&old.googleStatus===ev.status){skipped++;continue;}
  const key=await digest(eventIdentity(ev));
  if(!/^[a-f0-9]{32,128}$/i.test(key))throw Error('Digest output must be hex');
  const id=old?.id||'google_'+key.slice(0,40);
  const result=B.perform(next,{type:'saveSchedule',operationId:'calendar_'+key.slice(0,40)+'_'+(ev.updated?await digest(ev.updated):await digest(JSON.stringify(ev))).slice(0,24),id,date:ev.date,title:ev.title,description:ev.description,googleEventId:ev.eventId,calendarId:ev.calendarId,googleUpdatedAt:ev.updated,googleStatus:ev.status,location:ev.location,start:ev.start,end:ev.end});
  next=result.state;if(old)updated++;else added++;
 }
 return {state:next,summary:{added,updated,skipped,cancelled}};
}
async function collectPages(fetchPage,{calendarId,timeMin,timeMax}){
 if(typeof fetchPage!=='function'||!calendarId)throw Error('Calendar fetch adapter missing');
 let cursor=null,seen=new Set(),events=[];
 for(let i=0;i<100;i++){
  const response=await fetchPage({calendarId,pageToken:cursor,timeMin,timeMax});
  if(!response||!Array.isArray(response.items))throw Error('Google Calendar page is invalid');
  events.push(...response.items);
  const next=normalize(response.nextPageToken);
  if(!next)return events;
  if(seen.has(next))throw Error('Calendar pagination loop');seen.add(next);cursor=next;
 }
 throw Error('Calendar pagination exceeded limit');
}
async function patchLinkedEvent({provider,calendarId,eventId,etag,description,summary}){
 if(!provider||typeof provider.patch!=='function')throw Error('Google API provider not configured');
 if(!calendarId||!eventId)throw Error('Calendar identity missing');
 const patch={description,summary};
 try{return {status:'updated',event:await provider.patch({calendarId,eventId,etag,patch})};}
 catch(e){if(e.status===409||e.status===412)return {status:'conflict',requiresReview:true,error:String(e.message||e)};throw e;}
}
return {parseGoogleEvent,applyIncoming,collectPages,patchLinkedEvent,eventIdentity};
});
