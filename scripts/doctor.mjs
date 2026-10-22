import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';

const root=fileURLToPath(new URL('../',import.meta.url));
const windows=process.platform==='win32';
const npm=windows?'npm.cmd':'npm';
let runtime=false;
try{runtime=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).name==='aurora-runtime';}catch{}
let failures=0;
function report(level,title,detail=''){
  if(level==='FAIL')failures++;
  console.log(`[${level}] ${title}${detail?' — '+detail:''}`);
}
console.log('曜集环境检查（只读；不输出凭证或配置值）');
const major=Number(process.versions.node.split('.')[0]);
report(major>=24?'OK':'FAIL','Node.js',`当前 ${process.version}；要求 >=24，验证基线为 Node 24 LTS`);
const files=[
  ['项目清单','package.json'],['依赖锁文件','package-lock.json'],
  ['API 框架','node_modules/fastify/fastify.js']
];
if(runtime)files.push(['静态服务','node_modules/@fastify/static/index.js'],['预构建商城','public/index.html']);
else files.push(['uni-app 编译器','node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'],['H5 运行库','node_modules/@dcloudio/uni-h5/dist/uni-h5.es.js'],['PostCSS','node_modules/postcss/lib/postcss.js']);
for(const [title,file] of files)report(existsSync(resolve(root,file))?'OK':'FAIL',title,existsSync(resolve(root,file))?'文件存在':'文件缺失，请先停止运行中的服务，再安装完整依赖');
let values={};
const envPath=resolve(root,'.env');
if(existsSync(envPath)){
  try{
    for(const line of readFileSync(envPath,'utf8').split(/\r?\n/)){
      const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if(!m)continue;
      let value=m[2];
      if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
      values[m[1]]=value;
    }
    report('OK','.env','存在；仅检查所需名称与配置状态');
  }catch{report('FAIL','.env','无法读取，检查文件权限');}
}else report('WARN','.env',`尚未生成；${runtime?'npm start':'npm run start:local'} 会在首次启动时生成，不会覆盖已有文件`);
const configured=name=>process.env[name]??values[name];
for(const name of ['APP_MODE','HOST','PORT','DB_PATH','ADMIN_TOKEN','ALLOWED_ORIGINS']){
  report(configured(name)?'OK':'WARN',name,configured(name)?'已配置':'未配置；可能使用默认值或首次启动初始化');
}
if(configured('ADMIN_TOKEN')&&configured('ADMIN_TOKEN').length<32)report('FAIL','运营凭证强度','ADMIN_TOKEN 未达到至少 32 字符要求；请在本机安全配置中修改，不要发送给他人');
if(configured('APP_MODE')&&configured('APP_MODE')!=='demo')report('FAIL','运行模式','当前版本只允许受控测试模式，正式平台集成尚未完成');
if(!runtime&&process.env.NODE_ENV==='production')report('WARN','开发依赖安装环境','当前环境可能省略开发依赖，请明确使用 ci --include=dev');
if(windows)report('INFO','PowerShell','使用 npm.cmd，避免 npm.ps1 执行策略问题，无需放宽系统执行策略');
if(process.argv.includes('--network')){
  const port=Number(configured('PORT')||3001);
  if(!Number.isInteger(port)||port<1||port>65535)report('FAIL','API 端口','不是有效端口');
  else{
    const listening=await new Promise(resolve=>{
      const socket=createConnection({host:'127.0.0.1',port});
      socket.setTimeout(1500);
      socket.once('connect',()=>{socket.destroy();resolve(true)});
      socket.once('error',()=>{socket.destroy();resolve(false)});
      socket.once('timeout',()=>{socket.destroy();resolve(false)});
    });
    report(listening?'OK':'WARN','本机 API 监听',listening?'端口有服务，继续验证身份':'未监听；若尚未启动属于预期');
    if(listening){
      try{
        const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2500),redirect:'error'});
        const data=await r.json();
        if(r.ok&&data.ok===true&&data.mode==='demo')report('OK','API 健康检查','已识别本项目测试 API');
        else report('FAIL','API 健康检查','端口服务不是预期测试 API，或返回异常；不要结束未知进程');
      }catch{report('FAIL','API 健康检查','无法验证；检查该端口服务与代理配置，不要结束未知进程');}
    }
  }
}
console.log('\n建议操作（在项目目录执行）：');
const install=runtime?'ci --omit=dev':'ci --include=dev';
console.log(windows?`  ${npm} ${install} --cache "$env:TEMP\\aurora-npm-cache"`:`  ${npm} ${install}`);
console.log(`  ${npm} ${runtime?'start':'run start:local'}`);
console.log('不要同时使用 HBuilderX 另起同一项目；不要删除 .env、.data 或 package-lock.json。');
console.log('如需检查本机监听服务：node scripts/doctor.mjs --network');
console.log(failures?`\n发现 ${failures} 项阻塞，请按提示处理。`:'\n必需文件检查通过；这不代表真实支付、广告、风控或正式发布已接入。');
process.exitCode=failures?1:0;
