import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function portNumber(value, fallback, name){
  const port=Number(value||fallback);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error(`${name} 必须是 1–65535 的整数`);
  return port;
}
export function missingDependencies(root){
  return ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','node_modules/@dcloudio/uni-h5/dist/uni-h5.es.js','node_modules/postcss/lib/postcss.js','node_modules/fastify/fastify.js'].filter(file=>!existsSync(resolve(root,file)));
}
export async function checkPortAvailable(port){
  await new Promise((resolve,reject)=>{
    const probe=createServer();
    probe.once('error',()=>reject(new Error(`端口 ${port} 已被占用或无法监听。请先停止旧项目；不会自动结束其他进程。`)));
    probe.listen(port,'127.0.0.1',()=>probe.close(resolve));
  });
}
export async function waitForApi(port,stopped=()=>false,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline&&!stopped()){
    try{
      const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(700)});
      const body=await response.json();
      if(response.ok&&body.ok===true&&body.mode==='demo')return;
    }catch{}
    await delay(150);
  }
  if(stopped())throw new Error('API 进程已停止，请查看上方启动错误。');
  throw new Error('API 未在规定时间内就绪，请检查后端日志。');
}
