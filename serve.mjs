import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'docs');
const base='/Neonix-World/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'||url.pathname==='/Neonix-World'){res.writeHead(302,{Location:base});return res.end();}
  if(!url.pathname.startsWith(base)){res.writeHead(404);return res.end();}
  const relative=decodeURIComponent(url.pathname.slice(base.length))||'index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
  if(req.method==='HEAD')return res.end();
  fs.createReadStream(file).pipe(res);
 }catch{res.writeHead(400);res.end();}
}).listen(4174,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4174/Neonix-World/'));
