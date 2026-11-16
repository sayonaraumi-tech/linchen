/* Test-only local static server. No production credentials, no network API, no writes. */
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {renderFormal,closeBrowser}=require('./pdf-export.cjs');
const allowed=new Set(['.html','.js','.css','.json','.svg']);
function handler(req,res){
 try{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/api/test-pdf'){
   if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(405).end('Not Allowed');return;}
   const origin=req.headers.origin,host=req.headers.host;
   if(!origin||origin!==('http://'+host)||!/^127\.0\.0\.1:\d+$/.test(String(host))){res.writeHead(403).end('Invalid Origin');return;}
   let size=0,parts=[];
   req.on('data',chunk=>{
    size+=chunk.length;
    if(size>300000){req.destroy();return;}
    parts.push(chunk);
   });
   req.on('end',async()=>{
    try{
     if(size>300000)throw Error('PDF snapshot too large');
     const parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));
     const out=await renderFormal({document:parsed.document});
     res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store','X-Document-Filename':encodeURIComponent(out.filename)});
     res.end(out.bytes);
    }catch(e){res.writeHead(422,{'Content-Type':'application/json'}).end(JSON.stringify({error:String(e.message||e)}));}
   });
   return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end('Method Not Allowed');return;}
  let url=pathname==='/'?'/app/index.html':pathname;
  if(!url.startsWith('/app/')&&!url.startsWith('/src/')){res.writeHead(404).end('Not Found');return;}
  let file=path.resolve(root,'.'+url);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end('Forbidden');return;}
  const ext=path.extname(file);
  if(!allowed.has(ext)){res.writeHead(403).end('Forbidden');return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end('Not Found');return;}
  const type={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[ext];
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD'){res.end();return;}
  fs.createReadStream(file).pipe(res);
 }catch(e){res.writeHead(500).end('Internal Error');}
}
function serve(port=4173,host='127.0.0.1'){
 return new Promise(resolve=>{
  const server=http.createServer(handler);
  server.on('close',()=>{closeBrowser().catch(()=>{});});
  server.listen(port,host,()=>resolve({server,address:server.address(),url:'http://'+host+':'+server.address().port+'/app/index.html'}));
 });
}
if(require.main===module){
 serve(Number(process.env.PORT||4173)).then(({url})=>console.log('TEST-ONLY '+url)).catch(e=>{console.error(e);process.exitCode=1});
}
module.exports={serve,handler,closeBrowser};
