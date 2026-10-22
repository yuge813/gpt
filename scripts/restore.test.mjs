import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { restoreDatabase } from './restore.mjs';

function fixture(t){const dir=mkdtempSync(resolve(tmpdir(),'aurora-restore-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function create(path){const db=new DatabaseSync(path);db.exec("PRAGMA journal_mode=WAL;CREATE TABLE samples(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO samples VALUES(1,'committed');");return db;}

test('restore publishes an independent consistent snapshot including committed WAL data',async t=>{
  const dir=fixture(t),source=resolve(dir,'备份.sqlite'),destination=resolve(dir,'新目录','restored.sqlite');
  const sourceDb=create(source);
  try{await restoreDatabase(source,destination);
  const restored=new DatabaseSync(destination);try{
    assert.equal(restored.prepare('SELECT value FROM samples').get().value,'committed');
    restored.exec("UPDATE samples SET value='new-copy'");
    assert.equal(sourceDb.prepare('SELECT value FROM samples').get().value,'committed');
  }finally{restored.close();}
  assert.deepEqual(readdirSync(resolve(dir,'新目录')),['restored.sqlite']);
  }finally{sourceDb.close();}
});

test('restore refuses same paths, existing files, hard links and sidecar collisions without changing them',async t=>{
  const dir=fixture(t),source=resolve(dir,'source.sqlite'),destination=resolve(dir,'target.sqlite');
  const db=create(source);db.close();const before=readFileSync(source);
  await assert.rejects(()=>restoreDatabase(source,source),/相同/);
  writeFileSync(destination,'keep-this-file');
  await assert.rejects(()=>restoreDatabase(source,destination),/不会覆盖/);
  assert.equal(readFileSync(destination,'utf8'),'keep-this-file');
  const hardlink=resolve(dir,'hardlink.sqlite');linkSync(source,hardlink);
  await assert.rejects(()=>restoreDatabase(source,hardlink),/不会覆盖/);
  const sidecar=resolve(dir,'new.sqlite');writeFileSync(sidecar+'-wal','keep-wal');
  await assert.rejects(()=>restoreDatabase(source,sidecar),/不会覆盖/);
  assert.equal(readFileSync(sidecar+'-wal','utf8'),'keep-wal');assert.equal(existsSync(sidecar),false);
  assert.deepEqual(readFileSync(source),before);
});

test('restore rejects corrupt, incomplete and foreign-key-inconsistent backups without publishing output',async t=>{
  const dir=fixture(t),destination=resolve(dir,'output.sqlite');
  for(const [name,data] of [['not-sqlite','bad data'],['broken-sqlite','SQLite format 3\0'+'x'.repeat(128)],['empty','']]){
    const source=resolve(dir,name);writeFileSync(source,data);
    await assert.rejects(()=>restoreDatabase(source,destination));assert.equal(existsSync(destination),false);
  }
  const invalid=resolve(dir,'invalid.sqlite'),db=new DatabaseSync(invalid);
  db.exec('PRAGMA foreign_keys=OFF;CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(123);');db.close();
  await assert.rejects(()=>restoreDatabase(invalid,destination),/外键/);assert.equal(existsSync(destination),false);
  assert.ok(!readdirSync(dir).some(name=>name.startsWith('.aurora-restore-')));
});

test('restore validates ordinary paths and refuses symlink targets including broken links',async t=>{
  const dir=fixture(t),source=resolve(dir,'source.sqlite');const db=create(source);db.close();
  for(const bad of ['',null,':memory:','file:backup.sqlite','bad\0path']){
    await assert.rejects(()=>restoreDatabase(bad,resolve(dir,'new.sqlite')),/普通 SQLite/);
    await assert.rejects(()=>restoreDatabase(source,bad),/普通 SQLite/);
  }
  await assert.rejects(()=>restoreDatabase(resolve(dir,'missing.sqlite'),resolve(dir,'new.sqlite')),/普通文件/);
  await assert.rejects(()=>restoreDatabase(dir,resolve(dir,'new.sqlite')),/普通文件/);
  const alias=resolve(dir,'alias.sqlite'),broken=resolve(dir,'broken.sqlite'),parentAlias=resolve(dir,'alias-dir');
  try{symlinkSync(source,alias);symlinkSync(resolve(dir,'not-there'),broken);symlinkSync(dir,parentAlias,'dir');}catch(error){if(error.code==='EPERM'){t.diagnostic('symlink privileges unavailable; remaining alias checks skipped');return;}throw error;}
  await assert.rejects(()=>restoreDatabase(alias,resolve(dir,'new.sqlite')),/普通文件/);
  await assert.rejects(()=>restoreDatabase(source,alias),/不会覆盖/);
  await assert.rejects(()=>restoreDatabase(source,broken),/不会覆盖/);
  await assert.rejects(()=>restoreDatabase(source,resolve(parentAlias,'source.sqlite')),/不会覆盖|相同/);
  assert.equal(existsSync(resolve(dir,'new.sqlite')),false);
});


test('restore CLI requires explicit paths and handles spaces without changing configuration',async t=>{
  const dir=fixture(t),source=resolve(dir,'备份 source.sqlite'),destination=resolve(dir,'恢复 target.sqlite');
  const db=create(source);db.close();writeFileSync(resolve(dir,'.env'),'DB_PATH=must-stay-unchanged.sqlite\n');
  const script=fileURLToPath(new URL('./restore.mjs',import.meta.url));
  const missing=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});
  assert.equal(missing.status,1);assert.match(missing.stderr,/用法/);assert.equal(existsSync(destination),false);
  const result=spawnSync(process.execPath,[script,'--source','备份 source.sqlite','--destination','恢复 target.sqlite'],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/未切换服务配置/);assert.equal(existsSync(destination),true);
  assert.equal(readFileSync(resolve(dir,'.env'),'utf8'),'DB_PATH=must-stay-unchanged.sqlite\n');
  const again=spawnSync(process.execPath,[script,'--source',source,'--destination',destination],{cwd:dir,encoding:'utf8'});
  assert.equal(again.status,1);assert.match(again.stderr,/不会覆盖/);
});
