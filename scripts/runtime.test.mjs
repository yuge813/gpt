import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { portNumber, missingDependencies, checkPortAvailable } from './runtime.mjs';
import { backupDatabase } from './backup.mjs';

test('port checks reject collisions without stopping the existing service',async t=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const port=server.address().port;await assert.rejects(()=>checkPortAvailable(port),/已被占用/);assert.ok(server.listening);
  assert.throws(()=>portNumber('not-a-port',3001,'PORT'),/整数/);assert.equal(portNumber('',3001,'PORT'),3001);
});
test('missing dependency diagnosis works before running the compiler',()=>assert.ok(missingDependencies('/path/without/dependencies').some(p=>p.includes('uni.js'))));
test('online backup includes committed WAL data and preserves its source',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'aurora-backup-'));let db;t.after(()=>{if(db)db.close();rmSync(dir,{recursive:true,force:true});});
  const source=resolve(dir,'source.sqlite'),destination=resolve(dir,'backup.sqlite');
  db=new DatabaseSync(source);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE samples(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO samples VALUES(1,\'committed\');');
  await backupDatabase(source,destination);
  const restored=new DatabaseSync(destination,{readOnly:true});try{assert.equal(restored.prepare('SELECT value FROM samples').get().value,'committed');}finally{restored.close();}
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM samples').get().n,1);
  await assert.rejects(()=>backupDatabase(source,source),/相同/);await assert.rejects(()=>backupDatabase(source,destination),/不会覆盖/);
});
