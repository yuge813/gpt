import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';

export async function backupDatabase(source,destination){
  if(resolve(source)===resolve(destination))throw new Error('备份目标不能与源数据库相同');
  if(!existsSync(source))throw new Error('数据库尚不存在，请先启动 API');
  if(existsSync(destination))throw new Error('目标备份已存在，不会覆盖');
  mkdirSync(dirname(destination),{recursive:true,mode:0o700});
  const db=new DatabaseSync(source,{readOnly:true});
  try{await backup(db,destination);}finally{db.close();}
  chmodSync(destination,0o600);
  const snapshot=new DatabaseSync(destination,{readOnly:true});
  try{if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('备份完整性校验失败');}finally{snapshot.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  if(existsSync(resolve(root,'.env')))loadEnvFile(resolve(root,'.env'));
  const destination=resolve(root,'.backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.sqlite');
  try{await backupDatabase(resolve(root,process.env.DB_PATH||'.data/aurora.sqlite'),destination);console.log('一致性备份完成并通过完整性校验：'+destination);console.log('备份含账户和业务数据，请限制访问，并复制至受控的异机存储。');}catch(error){console.error(error.message);process.exitCode=1;}
}
