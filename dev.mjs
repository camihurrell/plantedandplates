import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import handler from './server.mjs';
await import('./build.mjs');
const root=resolve('dist');
http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost:5173').pathname;
  if(pathname==='/api/app')return handler(req,res);
  try{
    const file=resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
    if(!file.startsWith(root+sep))throw new Error('Invalid path');
    const bytes=await readFile(file);
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(file)]||'application/octet-stream');
    res.end(bytes);
  }catch{res.statusCode=404;res.end('Not found');}
}).listen(5173,()=>console.log('Kitchen preview: http://localhost:5173'));
