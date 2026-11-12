import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerFrontend} from '../frontend.js';
let directory,server,base;
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'payday-static-'));
 await mkdir(join(directory,'assets'));
 await writeFile(join(directory,'index.html'),'<html><body>React test shell</body></html>');
 await writeFile(join(directory,'assets','app.js'),'export const loaded=true;');
 const app=express();
 app.get('/api/health',(req,res)=>res.json({status:'ok'}));
 app.use('/api',(req,res)=>res.status(404).json({message:'API not found'}));
 registerFrontend(app,directory);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
test('Express serves React assets and SPA deep links while missing API/assets remain 404',async()=>{
 for(const path of ['/','/employee/history','/reports/period/123']){
  const r=await fetch(base+path,{headers:{Accept:'text/html'}});assert.equal(r.status,200);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.match(await r.text(),/React test shell/);
 }
 const js=await fetch(base+'/assets/app.js');assert.equal(js.status,200);assert.match(await js.text(),/loaded=true/);
 const health=await fetch(base+'/api/health');assert.deepEqual(await health.json(),{status:'ok'});
 for(const path of ['/api','/api/missing','/assets/missing.js','/missing.css','/.env','/server/.env'])assert.equal((await fetch(base+path)).status,404,path);
 const noHtml=await fetch(base+'/not-an-api',{headers:{Accept:'application/json'}});assert.equal(noHtml.status,404);
});
test('production fails clearly if React has not been built',()=>{
 const original=process.env.NODE_ENV;process.env.NODE_ENV='production';
 try{assert.throws(()=>registerFrontend(express(),join(directory,'absent')),/React build missing/);}
 finally{if(original===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=original;}
});
