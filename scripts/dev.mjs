import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { portNumber, missingDependencies, checkPortAvailable, waitForApi } from './runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(Number(process.versions.node.split('.')[0])<24){console.error('需要 Node.js 24 或更新版本，建议使用 Node.js 24 LTS。');process.exit(1);}
const missing=missingDependencies(root);
if(missing.length){
  console.error('项目依赖不完整，请先停止 HBuilderX/旧服务，再在项目目录执行 npm.cmd ci（Windows）或 npm ci。');
  console.error('缺少：'+missing.join(', '));process.exit(1);
}
if(!existsSync(resolve(root,'.env'))){
  writeFileSync(resolve(root,'.env'),`APP_MODE=demo\nHOST=127.0.0.1\nPORT=3001\nDB_PATH=.data/aurora.sqlite\nADMIN_TOKEN=${randomBytes(32).toString('hex')}\nALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\n`,{flag:'wx',mode:0o600});
  console.log('已生成本地 .env（含随机运营凭证，已被 Git 忽略）。');
}
loadEnvFile(resolve(root,'.env'));
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');process.exit(code)},1200).unref();}
function start(args){const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env});children.push(child);child.on('exit',code=>{if(!stopping)stop(code||0)});child.on('error',()=>stop(1));return child;}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop());
try{
  const apiPort=portNumber(process.env.PORT,3001,'PORT');
  const frontendPort=portNumber(process.env.FRONTEND_PORT,5173,'FRONTEND_PORT');
  if(apiPort===frontendPort)throw new Error('API 与前端不能使用同一个端口。');
  await Promise.all([checkPortAvailable(apiPort),checkPortAvailable(frontendPort)]);
  start(['--env-file-if-exists=.env','server/index.mjs']);
  await waitForApi(apiPort,()=>stopping);
  if(!stopping){console.log('API 已就绪，正在启动商城前端。');start(['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--host','127.0.0.1']);}
}catch(error){console.error(error.message);stop(1);process.exitCode=1;}
