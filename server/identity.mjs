import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive=promisify(scrypt);
const options=Object.freeze({N:32768,r:8,p:1,maxmem:64*1024*1024});
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{statusCode:status});
const invalid=()=>fail(401,'账号或密码不正确，或暂时无法登录');
const usernameSchema={type:'string',minLength:3,maxLength:32,pattern:'^[A-Za-z0-9_]+$'};
const passwordSchema={type:'string',minLength:12,maxLength:128,pattern:'\\S'};
const schema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const same=(a,b)=>a.length===b.length&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));

export function registerIdentity({app,db,now,auth,tx,profile,mode}){
  // Bound both memory and libuv work; requests never queue an unbounded KDF backlog.
  let active=0;
  const dummySalt=randomBytes(32).toString('hex'),dummyHash=randomBytes(64).toString('hex');
  async function hash(password,salt){
    if(active>=4)throw fail(429,'登录服务繁忙，请稍后重试');
    active++;
    try{return (await derive(password,Buffer.from(salt,'hex'),64,options)).toString('hex');}
    finally{active--;}
  }
  function session(uid){
    const token=randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());
    db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token),uid,now()+7*86400000);
    return token;
  }
  const result=(uid,token)=>({token,user:profile(uid),mode});
  const accountByName=db.prepare('SELECT * FROM accounts WHERE username=?');
  const accountById=db.prepare('SELECT * FROM accounts WHERE user_id=?');
  app.post('/api/auth/register',{
    schema:{body:schema({username:usernameSchema,password:passwordSchema,consent:{type:'boolean',const:true}})},
    config:{rateLimit:{max:5,timeWindow:'1 minute'}}
  },async(req,reply)=>{
    const username=req.body.username.toLowerCase(),salt=randomBytes(32).toString('hex');
    const passwordHash=await hash(req.body.password,salt),uid=randomUUID();
    const token=tx(()=>{
      // Checked after the asynchronous KDF, inside the same transaction as creation.
      if(accountByName.get(username))throw fail(409,'该账号名不可用，请更换');
      db.prepare('INSERT INTO users(id,name,points,created_at) VALUES(?,?,0,?)').run(uid,username,now());
      db.prepare('INSERT INTO accounts(user_id,username,password_salt,password_hash,updated_at) VALUES(?,?,?,?,?)').run(uid,username,salt,passwordHash,now());
      return session(uid);
    });
    reply.code(201);return result(uid,token);
  });
  app.post('/api/auth/login',{
    schema:{body:schema({username:usernameSchema,password:passwordSchema})},
    config:{rateLimit:{max:12,timeWindow:'1 minute'}}
  },async req=>{
    const account=accountByName.get(req.body.username.toLowerCase());
    // Unknown and locked usernames still pay the same KDF cost and return one error.
    const candidate=await hash(req.body.password,account?.password_salt??dummySalt);
    const verified=same(candidate,account?.password_hash??dummyHash);
    const token=tx(()=>{
      const current=account&&accountById.get(account.user_id);
      if(!current||current.password_hash!==account.password_hash||current.password_salt!==account.password_salt)return null;
      if(current.locked_until>now())return null;
      if(!verified){
        const attempts=(current.locked_until>0?0:current.failed_attempts)+1;
        db.prepare('UPDATE accounts SET failed_attempts=?,locked_until=? WHERE user_id=?').run(attempts,attempts>=5?now()+15*60000:0,current.user_id);
        return null;
      }
      db.prepare('UPDATE accounts SET failed_attempts=0,locked_until=0 WHERE user_id=?').run(current.user_id);
      return session(current.user_id);
    });
    if(!token)throw invalid();
    return result(account.user_id,token);
  });
  app.post('/api/auth/password',{
    preHandler:auth,
    schema:{body:schema({currentPassword:{type:'string',minLength:1,maxLength:128},newPassword:passwordSchema})},
    config:{rateLimit:{max:5,timeWindow:'1 minute'}}
  },async req=>{
    if(req.body.currentPassword===req.body.newPassword)throw fail(400,'新密码应与原密码不同');
    const account=accountById.get(req.uid);
    const candidate=await hash(req.body.currentPassword,account?.password_salt??dummySalt);
    if(!account||!same(candidate,account.password_hash))throw invalid();
    const salt=randomBytes(32).toString('hex'),passwordHash=await hash(req.body.newPassword,salt);
    const token=tx(()=>{
      const activeSession=db.prepare('SELECT 1 FROM sessions WHERE hash=? AND user_id=? AND expires_at>?').get(sha(req.headers.authorization.slice(7)),req.uid,now());
      if(!activeSession)throw fail(401,'登录状态已失效，请重新登录');
      const changed=db.prepare('UPDATE accounts SET password_salt=?,password_hash=?,failed_attempts=0,locked_until=0,updated_at=? WHERE user_id=? AND password_salt=? AND password_hash=?')
        .run(salt,passwordHash,now(),req.uid,account.password_salt,account.password_hash);
      if(!changed.changes)throw fail(409,'账号凭证已变更，请重新登录后重试');
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.uid);
      db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(),'account.password.change',JSON.stringify({userId:req.uid}),now());
      return session(req.uid);
    });
    return result(req.uid,token);
  });
}
