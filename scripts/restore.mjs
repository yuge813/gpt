import { DatabaseSync, backup } from 'node:sqlite';
import { lstatSync, realpathSync, mkdirSync, mkdtempSync, linkSync, chmodSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

function entry(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
function validatePath(value,label){
  if(typeof value!=='string'||!value.trim()||value.includes('\0')||value===':memory:'||/^file:/i.test(value))throw new Error(`${label}必须是普通 SQLite 文件路径`);
  return resolve(value);
}
function verify(db){
  const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error('数据库完整性校验失败，未发布恢复文件');
  if(db.prepare('PRAGMA foreign_key_check').get())throw new Error('数据库外键校验失败，未发布恢复文件');
}
function ensureUnused(path){
  // Old sidecar files can cause SQLite to apply unrelated WAL data later.
  if([path,path+'-wal',path+'-shm',path+'-journal'].some(p=>entry(p)))throw new Error('恢复目标或其日志文件已存在，不会覆盖；请选择全新文件名');
}

export async function restoreDatabase(source,destination){
  const sourcePath=validatePath(source,'备份源'),requested=validatePath(destination,'恢复目标');
  const sourceEntry=entry(sourcePath);
  if(!sourceEntry?.isFile()||sourceEntry.isSymbolicLink())throw new Error('备份源必须是已存在的普通文件，不能是符号链接或目录');
  const actualSource=realpathSync(sourcePath);
  if(actualSource===requested)throw new Error('恢复目标不能与备份源相同');
  ensureUnused(requested);
  const header=Buffer.alloc(16),handle=openSync(actualSource,'r');
  try{if(readSync(handle,header,0,16,0)!==16||!header.equals(Buffer.from('SQLite format 3\0')))throw new Error('备份源不是有效 SQLite 文件');}finally{closeSync(handle);}
  let db;
  try{db=new DatabaseSync(actualSource,{readOnly:true});verify(db);}catch(error){db?.close();throw error;}
  let staging;
  try{
    mkdirSync(dirname(requested),{recursive:true,mode:0o700});
    const parent=realpathSync(dirname(requested)),target=resolve(parent,basename(requested));
    if(target===actualSource)throw new Error('恢复目标不能与备份源相同');
    ensureUnused(target);
    staging=mkdtempSync(resolve(parent,'.aurora-restore-'));
    const snapshot=resolve(staging,'snapshot.sqlite');
    await backup(db,snapshot);
    chmodSync(snapshot,0o600);
    const restored=new DatabaseSync(snapshot,{readOnly:true});
    try{verify(restored);}finally{restored.close();}
    ensureUnused(target);
    // An atomic hard link publishes the verified snapshot without replacing a
    // file that appeared after our checks. No rename-over-existing fallback.
    try{linkSync(snapshot,target);}catch(error){
      if(error.code==='EEXIST')throw new Error('恢复目标已存在，不会覆盖；请选择全新文件名');
      throw new Error('无法安全发布恢复文件（文件系统需支持同卷硬链接）；源文件与已有目标未覆盖');
    }
    return target;
  }finally{db.close();if(staging)rmSync(staging,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length!==4||args[0]!=='--source'||args[2]!=='--destination')throw new Error('用法：node scripts/restore.mjs --source "备份.sqlite" --destination "全新恢复路径.sqlite"');
    const target=await restoreDatabase(args[1],args[3]);
    console.log('已生成通过完整性与外键检查的独立恢复文件：'+target);
    console.log('未切换服务配置。请先停服并备份当前数据，再按 docs/RESTORE.md 手动设置 DB_PATH、重启并验收。');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
