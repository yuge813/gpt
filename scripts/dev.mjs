import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!existsSync(resolve(root,'.env'))){
  writeFileSync(resolve(root,'.env'),`APP_MODE=demo\nHOST=127.0.0.1\nPORT=3001\nDB_PATH=.data/aurora.sqlite\nADMIN_TOKEN=${randomBytes(32).toString('hex')}\nALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\n`,{flag:'wx',mode:0o600});
  console.log('已生成本地 .env（含随机运营凭证，已被 Git 忽略）。');
}
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),700).unref();}
function start(args){const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env});children.push(child);child.on('exit',code=>{if(!stopping)stop(code||0)});child.on('error',()=>stop(1));return child;}
start(['--env-file-if-exists=.env','server/index.mjs']);
start(['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--host','127.0.0.1']);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop());
