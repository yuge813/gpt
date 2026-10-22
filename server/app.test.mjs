import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, dayKey } from './app.mjs';

async function fixture(t){
  let clock=Date.UTC(2026,9,22,4);
  const app=await buildApp({dbPath:':memory:',now:()=>clock,adminToken:'a'.repeat(40)});
  t.after(()=>app.close());
  const call=(method,url,payload,token,extra={})=>app.inject({method,url,payload,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...extra}});
  const login=async()=>{const r=await call('POST','/api/auth/demo',{consent:true});assert.equal(r.statusCode,201);return r.json()};
  return {app,call,login,advance:ms=>clock+=ms};
}
test('public readiness, consent validation, session hashing and revocation',async t=>{
  const {app,call,login}=await fixture(t);
  assert.equal((await call('GET','/api/health')).json().integrations.ads,'demo');
  assert.equal((await call('POST','/api/auth/demo',{consent:false})).statusCode,400);
  assert.equal((await call('GET','/api/me')).statusCode,401);
  const {token,user}=await login();assert.equal(user.points,1200);
  assert.notEqual(app.db.prepare('SELECT hash FROM sessions').get().hash,token);
  assert.equal((await call('GET','/api/me',undefined,token)).json().id,user.id);
  assert.equal((await call('POST','/api/auth/logout',{},token)).statusCode,200);
  assert.equal((await call('GET','/api/me',undefined,token)).statusCode,401);
});
test('check-in uses server date, rejects duplicate and rewards day seven',async t=>{
  const {call,login,advance}=await fixture(t);const {token}=await login();
  const first=await call('POST','/api/checkin',{},token);assert.equal(first.json().reward,20);
  assert.equal((await call('POST','/api/checkin',{},token)).statusCode,409);
  for(let d=2;d<=7;d++){advance(86400000);const r=await call('POST','/api/checkin',{},token);assert.equal(r.json().reward,d===7?100:20);assert.equal(r.json().user.streak,d);}
  assert.equal((await call('GET','/api/me',undefined,token)).json().points,1420);
  assert.equal(dayKey(Date.UTC(2026,9,22,16)), '2026-10-23');
});
test('redemption is idempotent, rejects overspending and leaves inventory unchanged on failure',async t=>{
  const {app,call,login}=await fixture(t);const {token}=await login();
  const payload={productId:'headphones',requestKey:'unique-order-key-12345'};
  const r=await call('POST','/api/orders',payload,token);assert.equal(r.statusCode,201);assert.equal(r.json().user.points,0);
  const again=await call('POST','/api/orders',payload,token);assert.equal(again.statusCode,200);assert.equal(again.json().order.id,r.json().order.id);
  assert.equal(app.db.prepare('SELECT stock FROM products WHERE id=?').get('headphones').stock,27);
  assert.equal((await call('POST','/api/orders',{...payload,productId:'cup'},token)).statusCode,409);
  const stock=app.db.prepare('SELECT stock FROM products WHERE id=?').get('cup').stock;
  assert.equal((await call('POST','/api/orders',{productId:'cup',requestKey:'second-unique-key-12345'},token)).statusCode,409);
  assert.equal(app.db.prepare('SELECT stock FROM products WHERE id=?').get('cup').stock,stock);
  const entries=(await call('GET','/api/ledger',undefined,token)).json().items;assert.equal(entries.length,2);assert.equal(entries.reduce((s,x)=>s+x.delta,0),0);
});
test('concurrent duplicate order requests deduct only once; sessions cannot see another account orders',async t=>{
  const {call,login}=await fixture(t);const a=await login(),b=await login();
  const payload={productId:'cup',requestKey:'parallel-order-key-12345'};
  const responses=await Promise.all(Array.from({length:6},()=>call('POST','/api/orders',payload,a.token)));
  assert.equal(responses.filter(r=>r.statusCode===201).length,1);
  assert.equal((await call('GET','/api/me',undefined,a.token)).json().points,700);
  assert.equal((await call('GET','/api/orders',undefined,b.token)).json().items.length,0);
});
test('ad demo rejects premature, foreign, repeated and expired claims; daily cap and cooldown enforced',async t=>{
  const {app,call,login,advance}=await fixture(t);const a=await login(),b=await login();
  const start=(await call('POST','/api/ads/start',{},a.token)).json();assert.equal(start.provider,'demo');
  assert.equal((await call('POST','/api/ads/claim',{sessionId:start.id},b.token)).statusCode,404);
  assert.equal((await call('POST','/api/ads/claim',{sessionId:start.id},a.token)).statusCode,409);
  assert.equal((await call('POST','/api/ads/start',{},a.token)).statusCode,429);
  advance(8000);assert.equal((await call('POST','/api/ads/claim',{sessionId:start.id},a.token)).json().reward,30);
  assert.equal((await call('POST','/api/ads/claim',{sessionId:start.id},a.token)).statusCode,409);
  for(let i=0;i<4;i++){advance(30000);const s=(await call('POST','/api/ads/start',{},a.token)).json();advance(8000);assert.equal((await call('POST','/api/ads/claim',{sessionId:s.id},a.token)).statusCode,200);}
  advance(30000);assert.equal((await call('POST','/api/ads/start',{},a.token)).statusCode,429);
  assert.equal((await call('GET','/api/me',undefined,a.token)).json().points,1350);
  assert.ok(app.db.prepare('SELECT COUNT(*) AS n FROM risk_events').get().n>=3);
  const stale=(await call('POST','/api/ads/start',{},b.token)).json();advance(600001);assert.equal((await call('POST','/api/ads/claim',{sessionId:stale.id},b.token)).statusCode,410);
});
test('multiple pending ad sessions cannot exceed daily reward limit',async t=>{
  const {call,login,advance}=await fixture(t);const {token}=await login();const ids=[];
  for(let i=0;i<6;i++){ids.push((await call('POST','/api/ads/start',{},token)).json().id);advance(30000);}
  for(let i=0;i<5;i++)assert.equal((await call('POST','/api/ads/claim',{sessionId:ids[i]},token)).statusCode,200);
  assert.equal((await call('POST','/api/ads/claim',{sessionId:ids[5]},token)).statusCode,429);
});
test('admin authorization, audited ad kill switch and strict request schemas',async t=>{
  const {app,call,login,advance}=await fixture(t);const {token}=await login();
  assert.equal((await call('GET','/api/admin/overview')).statusCode,403);
  assert.equal((await call('GET','/api/admin/overview',undefined,token)).statusCode,403);
  const headers={'x-admin-token':'a'.repeat(40)};
  const pending=(await call('POST','/api/ads/start',{},token)).json();advance(8000);
  assert.equal((await call('POST','/api/admin/settings',{adsEnabled:false},undefined,headers)).statusCode,200);
  assert.equal((await call('POST','/api/ads/start',{},token)).statusCode,409);
  assert.equal((await call('POST','/api/ads/claim',{sessionId:pending.id},token)).statusCode,409);
  assert.equal((await call('GET','/api/admin/overview',undefined,undefined,headers)).json().audits.length,1);
  assert.equal((await call('POST','/api/checkin',{reward:999999},token)).statusCode,400);
  assert.equal(app.db.prepare('SELECT points FROM users').get().points,1200);
});
test('stock exhaustion fails without spending and unconfigured production fails closed',async t=>{
  const {app,call,login}=await fixture(t);const {token}=await login();
  app.db.prepare('UPDATE products SET stock=0 WHERE id=?').run('cup');
  assert.equal((await call('POST','/api/orders',{productId:'cup',requestKey:'out-of-stock-key-1234'},token)).statusCode,409);
  assert.equal((await call('GET','/api/me',undefined,token)).json().points,1200);
  await assert.rejects(()=>buildApp({mode:'production',dbPath:':memory:'}),/正式模式/);
});
test('ad placements are opt-in, admin controlled, audited and visible in catalog',async t=>{
  const {call}=await fixture(t);const headers={'x-admin-token':'a'.repeat(40)};
  assert.deepEqual((await call('GET','/api/catalog')).json().placements,[]);
  assert.equal((await call('POST','/api/admin/placements',{id:'home_feature',enabled:true})).statusCode,403);
  assert.equal((await call('POST','/api/admin/placements',{id:'home_feature',enabled:true},undefined,headers)).statusCode,200);
  assert.equal((await call('GET','/api/catalog')).json().placements[0].id,'home_feature');
  assert.equal((await call('POST','/api/admin/placements',{id:'missing',enabled:true},undefined,headers)).statusCode,404);
});
test('manual account restriction blocks all reward paths and can be reversed with audit trail',async t=>{
  const {call,login}=await fixture(t);const {token,user}=await login();const headers={'x-admin-token':'a'.repeat(40)};
  const change=blocked=>call('POST','/api/admin/restrictions',{userId:user.id,blocked,reason:'manual review for test'},undefined,headers);
  assert.equal((await change(true)).statusCode,200);
  for(const path of ['/api/checkin','/api/ads/start'])assert.equal((await call('POST',path,{},token)).statusCode,403);
  assert.equal((await call('POST','/api/orders',{productId:'cup',requestKey:'restricted-order-12345'},token)).statusCode,403);
  const overview=(await call('GET','/api/admin/overview',undefined,undefined,headers)).json();
  assert.equal(overview.blockedUsers.length,1);assert.equal(overview.risks.length,3);
  assert.equal((await change(false)).statusCode,200);
  assert.equal((await call('POST','/api/checkin',{},token)).statusCode,200);
});
