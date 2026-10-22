import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.mjs';

const password='Account-test-secret-2026';
async function fixture(t,settings={}){
  let clock=Date.UTC(2026,9,22,4);
  const app=await buildApp({dbPath:':memory:',now:()=>clock,...settings});
  t.after(()=>app.close());
  const call=(path,payload,token)=>app.inject({method:'POST',url:'/api/auth/'+path,payload,headers:token?{authorization:'Bearer '+token}:{}});
  const me=token=>app.inject({url:'/api/me',headers:{authorization:'Bearer '+token}});
  return {app,call,me,advance:ms=>clock+=ms};
}

test('password identities validate consent and schema, normalize usernames and never expose credentials',async t=>{
  const {app,call,me}=await fixture(t);
  let invalidCase=0;
  for(const body of [
    {username:'valid_name',password,consent:false},
    {username:'bad name',password,consent:true},
    {username:'ab',password,consent:true},
    {username:'valid_name',password:'short',consent:true}
  ])assert.equal((await app.inject({method:'POST',url:'/api/auth/register',payload:body,remoteAddress:`198.51.100.${++invalidCase}`})).statusCode,400);
  const r=await call('register',{username:'Test_User',password,consent:true});assert.equal(r.statusCode,201);
  const value=r.json();assert.equal(value.user.username,'test_user');assert.equal(value.user.hasPassword,true);assert.equal(value.user.points,0);
  assert.equal((await me(value.token)).json().id,value.user.id);
  const row=app.db.prepare('SELECT * FROM accounts').get();
  assert.equal(row.password_hash.length,128);assert.equal(row.password_salt.length,64);
  assert.ok(!JSON.stringify(row).includes(password));assert.ok(!r.body.includes('password_hash'));assert.ok(!r.body.includes('password_salt'));
  assert.notEqual(app.db.prepare('SELECT hash FROM sessions').get().hash,value.token);
  assert.equal((await call('register',{username:'TEST_USER',password,consent:true})).statusCode,409);
  const login=await call('login',{username:'TEST_USER',password});assert.equal(login.statusCode,200);assert.equal(login.json().user.id,value.user.id);
});

test('unknown and wrong credentials share error, account lock persists and valid login resumes after lock expires',async t=>{
  const {app,call,advance}=await fixture(t);
  const created=(await call('register',{username:'rate_user',password,consent:true})).json();
  const unknown=await call('login',{username:'unknown_user',password});
  const wrong=await call('login',{username:'rate_user',password:'Wrong-password-2026'});
  assert.equal(unknown.statusCode,401);assert.equal(wrong.statusCode,401);assert.deepEqual(unknown.json(),wrong.json());
  for(let i=0;i<4;i++)assert.equal((await call('login',{username:'rate_user',password:'Wrong-password-2026'})).statusCode,401);
  assert.equal((await call('login',{username:'rate_user',password})).statusCode,401);
  assert.ok(app.db.prepare('SELECT locked_until FROM accounts WHERE user_id=?').get(created.user.id).locked_until>0);
  advance(15*60000+1);
  const recovered=await call('login',{username:'rate_user',password});assert.equal(recovered.statusCode,200);
  assert.equal(app.db.prepare('SELECT failed_attempts FROM accounts').get().failed_attempts,0);
});

test('password rotation requires old password, revokes every old session and preserves balance/history',async t=>{
  const {app,call,me}=await fixture(t);
  const original=(await call('register',{username:'rotate_user',password,consent:true})).json();
  const second=(await call('login',{username:'rotate_user',password})).json();
  app.db.prepare('UPDATE users SET points=123 WHERE id=?').run(original.user.id);
  assert.equal((await call('password',{currentPassword:password,newPassword:'Updated-password-2026'})).statusCode,401);
  assert.equal((await call('password',{currentPassword:password,newPassword:password},original.token)).statusCode,400);
  assert.equal((await call('password',{currentPassword:'wrong-old-password',newPassword:'Updated-password-2026'},original.token)).statusCode,401);
  const rotated=await call('password',{currentPassword:password,newPassword:'Updated-password-2026'},original.token);assert.equal(rotated.statusCode,200);
  const next=rotated.json();assert.equal(next.user.id,original.user.id);assert.equal(next.user.points,123);
  assert.equal((await me(original.token)).statusCode,401);assert.equal((await me(second.token)).statusCode,401);assert.equal((await me(next.token)).statusCode,200);
  assert.equal((await call('login',{username:'rotate_user',password})).statusCode,401);
  assert.equal((await call('login',{username:'rotate_user',password:'Updated-password-2026'})).statusCode,200);
  const audit=app.db.prepare("SELECT detail FROM audit WHERE action='account.password.change'").get();assert.ok(audit);assert.ok(!audit.detail.includes('password'));
});

test('concurrent registration and password rotation cannot duplicate users or leave stale sessions valid',async t=>{
  const {app,call,me}=await fixture(t);
  const registrations=await Promise.all([0,1].map(()=>call('register',{username:'parallel_user',password,consent:true})));
  assert.deepEqual(registrations.map(r=>r.statusCode).sort(),[201,409]);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
  const original=registrations.find(r=>r.statusCode===201).json();
  const rotations=await Promise.all([0,1].map(n=>call('password',{currentPassword:password,newPassword:`Updated-password-${n}-2026`},original.token)));
  assert.deepEqual(rotations.map(r=>r.statusCode).sort(),[200,401]);
  assert.equal((await me(original.token)).statusCode,401);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
  const next=rotations.find(r=>r.statusCode===200).json();assert.equal((await me(next.token)).statusCode,200);
});

test('identity migration and account login preserve legacy users, sessions and persisted balances after reopening',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'aurora-identity-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'db.sqlite');
  const {DatabaseSync}=await import('node:sqlite');const legacy=new DatabaseSync(path);
  legacy.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,points INTEGER NOT NULL,created_at INTEGER NOT NULL); CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);');
  const uid=randomUUID(),token='a'.repeat(64);legacy.prepare('INSERT INTO users VALUES(?,?,?,?)').run(uid,'legacy demo',55,Date.now());
  legacy.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),uid,Date.now()+86400000);legacy.close();
  let app=await buildApp({dbPath:path});
  const me=await app.inject({url:'/api/me',headers:{authorization:'Bearer '+token}});assert.equal(me.statusCode,200);assert.equal(me.json().points,55);assert.equal(me.json().username,null);assert.equal(me.json().hasPassword,false);
  const created=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'persistent_user',password,consent:true}});assert.equal(created.statusCode,201);const user=created.json().user;
  app.db.prepare('UPDATE users SET points=77 WHERE id=?').run(user.id);await app.close();
  app=await buildApp({dbPath:path});t.after(()=>app.close());
  const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'persistent_user',password}});assert.equal(login.statusCode,200);assert.equal(login.json().user.id,user.id);assert.equal(login.json().user.points,77);
  assert.equal(app.db.prepare('SELECT points FROM users WHERE id=?').get(uid).points,55);
});


test('identity routes rate-limit registration work without issuing extra users',async t=>{
  const {app,call}=await fixture(t);
  for(let n=0;n<5;n++)assert.equal((await call('register',{username:`limited_user_${n}`,password,consent:true})).statusCode,201);
  const blocked=await call('register',{username:'limited_user_5',password,consent:true});assert.equal(blocked.statusCode,429);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,5);
});


test('logout during password KDF prevents revoked session from rotating credentials',async t=>{
  const {call,me}=await fixture(t);
  const original=(await call('register',{username:'revoke_user',password,consent:true})).json();
  const pending=call('password',{currentPassword:password,newPassword:'Updated-password-2026'},original.token);
  // Yield once so preHandler authentication finishes and the asynchronous KDF starts.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call('logout',{},original.token)).statusCode,200);
  assert.equal((await pending).statusCode,401);
  assert.equal((await me(original.token)).statusCode,401);
  assert.equal((await call('login',{username:'revoke_user',password})).statusCode,200);
});
