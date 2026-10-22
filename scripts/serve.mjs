import { existsSync, realpathSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import fastifyStatic from '@fastify/static';
import { buildApp } from '../server/app.mjs';
import { portNumber } from './runtime.mjs';

export function frontendDirectory(root,requested){
  const path=resolve(root,requested||(existsSync(resolve(root,'public/index.html'))?'public':'dist/build/h5'));
  if(!existsSync(resolve(path,'index.html')))throw new Error('未找到已构建首页。源码项目请先执行 npm run build；部署包请保留 public 文件夹。');
  const actual=realpathSync(path),base=realpathSync(root),rel=relative(base,actual);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||['.env','package.json','server','.git'].some(name=>existsSync(resolve(actual,name))))throw new Error('静态目录必须是项目内独立的构建目录，不能暴露源码、配置或数据库。');
  // A symlink anywhere inside the published tree can expose files outside it.
  // Build output has no need for links; reject them before registering static routes.
  const pending=[actual];
  while(pending.length){
    for(const entry of readdirSync(pending.pop(),{withFileTypes:true})){
      if(entry.isSymbolicLink())throw new Error('静态构建目录不能包含符号链接，请使用完整独立的构建文件');
      if(entry.isDirectory())pending.push(resolve(entry.parentPath,entry.name));
    }
  }
  return actual;
}
export async function buildReleaseServer({root,staticDir,appOptions={}}){
  const directory=frontendDirectory(root,staticDir);
  const app=await buildApp(appOptions);
  await app.register(fastifyStatic,{root:directory,prefix:'/',dotfiles:'deny',index:['index.html'],redirect:false});
  return app;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  process.chdir(root);
  if(!existsSync(resolve(root,'.env'))){
    writeFileSync(resolve(root,'.env'),`APP_MODE=demo\nHOST=127.0.0.1\nPORT=3001\nDB_PATH=.data/aurora.sqlite\nADMIN_TOKEN=${randomBytes(32).toString('hex')}\n`,{flag:'wx',mode:0o600});
    console.log('已创建本地 .env 并生成随机运营凭证；凭证不会打印。');
  }
  loadEnvFile(resolve(root,'.env'));
  try{
    const app=await buildReleaseServer({root,staticDir:process.env.STATIC_DIR,appOptions:{logger:true}});
    await app.listen({host:process.env.HOST||'127.0.0.1',port:portNumber(process.env.PORT,3001,'PORT')});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0)});
    console.log('商城静态页面和 API 已在同一端口启动。当前为测试模式，不真实收款、发货或展示广告。');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
