import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { frontendDirectory, buildReleaseServer } from './serve.mjs';

test('prebuilt storefront serves with API and never serves local credentials',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'aurora-static-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(resolve(root,'public'));writeFileSync(resolve(root,'public/index.html'),'<html><body>Storefront build</body></html>');writeFileSync(resolve(root,'.env'),'DO_NOT_SERVE=this-is-only-a-fixture');
  const app=await buildReleaseServer({root,appOptions:{dbPath:':memory:'}});t.after(()=>app.close());
  const home=await app.inject('/');assert.equal(home.statusCode,200);assert.ok(home.body.includes('Storefront build'));assert.ok(home.headers['content-security-policy']);
  assert.equal((await app.inject('/api/health')).json().mode,'demo');
  for(const path of ['/.env','/../.env','/%2e%2e/.env','/package.json']){const r=await app.inject(path);assert.ok(r.statusCode>=400);assert.ok(!r.body.includes('DO_NOT_SERVE'));}
});
test('release serving refuses source root and escaping directory symlinks',t=>{
  const root=mkdtempSync(resolve(tmpdir(),'aurora-source-')),outside=mkdtempSync(resolve(tmpdir(),'aurora-outside-'));t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})});
  writeFileSync(resolve(root,'index.html'),'source');writeFileSync(resolve(root,'package.json'),'{}');assert.throws(()=>frontendDirectory(root,'.'),/不能暴露/);
  writeFileSync(resolve(outside,'index.html'),'outside');symlinkSync(outside,resolve(root,'public'),process.platform==='win32'?'junction':'dir');assert.throws(()=>frontendDirectory(root,'public'),/不能暴露/);
});
