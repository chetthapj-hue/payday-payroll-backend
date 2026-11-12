// Local QA only. Render terminates HTTPS itself; this script is never used by npm start.
import https from 'node:https';
import http from 'node:http';
import {readFileSync} from 'node:fs';
if(!process.env.TLS_CERT_FILE || !process.env.TLS_KEY_FILE) throw new Error('Set TLS_CERT_FILE and TLS_KEY_FILE to temporary local test files');
const port=Number(process.env.HTTPS_PORT || 3443),upstream=Number(process.env.UPSTREAM_PORT || 3100);
https.createServer({cert:readFileSync(process.env.TLS_CERT_FILE),key:readFileSync(process.env.TLS_KEY_FILE)},(req,res)=>{
 const proxy=http.request({host:'127.0.0.1',port:upstream,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${upstream}`,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host,'x-forwarded-for':req.socket.remoteAddress}},response=>{
  res.writeHead(response.statusCode,response.headers);response.pipe(res);
 });
 proxy.on('error',()=>{res.writeHead(502);res.end('Test upstream unavailable');});req.pipe(proxy);
}).listen(port,'127.0.0.1',()=>console.log(`Local HTTPS QA proxy: https://127.0.0.1:${port}`));
