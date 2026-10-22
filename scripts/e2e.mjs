import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each target owns a fresh API process, database and rate-limit state. Sharing
// one IP budget between rapid independent desktop/mobile suites causes false
// failures and is not a reason to weaken the application's rate limits.
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url));
let child;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child?.kill(signal);process.exitCode=130;});
for(const project of ['desktop','mobile']){
  if(process.exitCode)break;
  const status=await new Promise((resolve,reject)=>{
    child=spawn(process.execPath,[cli,'test',`--project=${project}`],{cwd:root,stdio:'inherit'});
    child.once('error',reject);child.once('exit',(code)=>resolve(code??1));
  });
  child=undefined;
  if(status){process.exitCode=Number(status);break;}
}
