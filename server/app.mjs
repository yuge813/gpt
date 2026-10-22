import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { openDb } from './db.mjs';
import { registerCommerce } from './commerce.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{statusCode:status});
export const dayKey=time=>new Date(time+8*3600000).toISOString().slice(0,10);
const bodySchema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const keySchema={type:'string',minLength:16,maxLength:128,pattern:'^[a-zA-Z0-9_-]+$'};

export async function buildApp(options={}){
  const mode=options.mode||process.env.APP_MODE||'demo';
  if(mode!=='demo')throw new Error('正式模式尚未启用：需完成真实身份认证、广告及风控集成和上线审查。');
  const app=Fastify({logger:options.logger??false,bodyLimit:16384,trustProxy:false,ajv:{customOptions:{removeAdditional:false,coerceTypes:false}}});
  const db=openDb(options.dbPath||process.env.DB_PATH||'.data/aurora.sqlite');
  const now=options.now||Date.now;
  const adminToken=options.adminToken??process.env.ADMIN_TOKEN??'';
  const origins=(options.origins||process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173').split(',');
  await app.register(cors,{origin:origins,allowedHeaders:['Content-Type','Authorization','X-Admin-Token'],methods:['GET','POST']});
  await app.register(helmet,{global:true});
  // Browsing/checkout refresh several read endpoints; protect the IP budget without
  // throttling a legitimate shopping session. Sensitive actions keep tighter limits.
  await app.register(rateLimit,{max:600,timeWindow:'1 minute'});
  app.decorate('db',db);
  app.addHook('onClose',()=>db.close());
  app.setErrorHandler((error,req,reply)=>{
    const status=error.validation?400:(error.statusCode||500);
    if(status>=500)req.log.error(error);
    reply.code(status).send({message:error.validation?'请求参数格式不正确':status>=500?'服务暂时不可用':error.message});
  });
  app.addHook('onSend',async(req,reply,payload)=>{reply.header('Cache-Control','no-store');return payload;});
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}
  function ledger(uid,delta,kind,label,event){
    const updated=db.prepare('UPDATE users SET points=points+? WHERE id=? AND points+?>=0').run(delta,uid,delta);
    if(!updated.changes)throw fail(409,'积分不足');
    db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?)').run(randomUUID(),uid,delta,kind,label,event,now());
  }
  function risk(uid,action,reason){db.prepare('INSERT INTO risk_events VALUES(?,?,?,?,?,?)').run(randomUUID(),uid,action,'deny',reason,now());}
  async function auth(req){
    const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const session=token&&db.prepare('SELECT user_id FROM sessions WHERE hash=? AND expires_at>?').get(sha(token),now());
    if(!session)throw fail(401,'请先登录，或重新进入演示体验');
    req.uid=session.user_id;
  }
  async function admin(req){
    const given=req.headers['x-admin-token'];
    if(adminToken.length<32)throw fail(503,'运营后台未配置安全访问凭证');
    if(typeof given!=='string'||!timingSafeEqual(Buffer.from(sha(given)),Buffer.from(sha(adminToken))))throw fail(403,'运营凭证无效');
  }
  function allowReward(uid,action){
    const blocked=db.prepare('SELECT reason FROM blocked_users WHERE user_id=?').get(uid);
    if(blocked){risk(uid,action,'account_restricted');throw fail(403,'账户奖励功能已被限制，请联系运营审核');}
  }
  function profile(uid){
    const u=db.prepare('SELECT id,name,points,created_at FROM users WHERE id=?').get(uid);
    const days=db.prepare('SELECT day FROM checkins WHERE user_id=? ORDER BY day DESC').all(uid).map(x=>x.day);
    let streak=0;let t=now();if(days[0]!==dayKey(t))t-=86400000;
    while(days.includes(dayKey(t))){streak++;t-=86400000;}
    return {...u,pendingPoints:db.prepare("SELECT COALESCE(SUM(reward),0) AS n FROM shop_orders WHERE user_id=? AND status IN ('paid','shipped')").get(uid).n,checkedIn:days.includes(dayKey(now())),streak,adCount:db.prepare('SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id=? AND day=? AND claimed=1').get(uid,dayKey(now())).n,adLimit:5};
  }
  app.get('/api/health',async()=>({ok:true,mode,integrations:{ads:'demo',risk:'local-rules',payment:'disabled',wechat:'not-configured'}}));
  app.get('/api/catalog',async()=>({products:db.prepare('SELECT * FROM products').all().map(p=>({...p,rewardPoints:Math.floor(p.price/100)})),placements:db.prepare('SELECT * FROM placements WHERE enabled=1').all(),adsEnabled:db.prepare('SELECT value FROM settings WHERE key=?').get('ads_enabled').value==='true'}));
  app.post('/api/auth/demo',{schema:{body:bodySchema({consent:{type:'boolean',const:true}})},config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async(req,reply)=>{
    const token=randomBytes(32).toString('hex'),uid=randomUUID();
    tx(()=>{
      db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(uid,'曜集体验官',0,now());
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),uid,now()+7*86400000);
    });
    reply.code(201);return {token,user:profile(uid),mode};
  });
  app.post('/api/auth/logout',{preHandler:auth},async req=>{db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(req.headers.authorization.slice(7)));return {ok:true};});
  app.get('/api/me',{preHandler:auth},async req=>profile(req.uid));
  app.get('/api/ledger',{preHandler:auth},async req=>({items:db.prepare('SELECT id,delta,kind,label,created_at FROM ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(req.uid)}));
  app.post('/api/checkin',{preHandler:async req=>{await auth(req);allowReward(req.uid,'checkin');},schema:{body:bodySchema({})}},async req=>tx(()=>{
    const day=dayKey(now());
    if(db.prepare('SELECT 1 FROM checkins WHERE user_id=? AND day=?').get(req.uid,day))throw fail(409,'今天已经签到，明天再来吧');
    const previous=profile(req.uid).streak;
    const reward=(previous+1)%7===0?100:20;
    db.prepare('INSERT INTO checkins VALUES(?,?)').run(req.uid,day);
    ledger(req.uid,reward,'checkin',reward===100?'连续 7 天签到奖励':'每日签到','checkin:'+req.uid+':'+day);
    return {reward,user:profile(req.uid)};
  }));
  app.post('/api/ads/start',{preHandler:auth,schema:{body:bodySchema({})},config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{
    allowReward(req.uid,'ad_start');
    if(db.prepare('SELECT value FROM settings WHERE key=?').get('ads_enabled').value!=='true')throw fail(409,'激励体验暂时关闭');
    const p=profile(req.uid);
    if(p.adCount>=5){risk(req.uid,'ad_start','daily_limit');throw fail(429,'今日广告奖励已达上限');}
    const last=db.prepare('SELECT created_at FROM ad_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(req.uid);
    if(last&&now()-last.created_at<30000){risk(req.uid,'ad_start','cooldown');throw fail(429,'体验过于频繁，请在 30 秒后重试');}
    const id=randomUUID();db.prepare('INSERT INTO ad_sessions VALUES(?,?,?,?,0)').run(id,req.uid,now(),dayKey(now()));
    return {id,minimumSeconds:8,reward:30,provider:'demo',message:'仅为内部演示，不产生真实广告收益'};
  });
  app.post('/api/ads/claim',{preHandler:auth,schema:{body:bodySchema({sessionId:{type:'string',format:'uuid'}})}},async req=>{
    allowReward(req.uid,'ad_claim');
    if(db.prepare('SELECT value FROM settings WHERE key=?').get('ads_enabled').value!=='true')throw fail(409,'激励体验暂时关闭');
    const ad=db.prepare('SELECT * FROM ad_sessions WHERE id=? AND user_id=?').get(req.body.sessionId,req.uid);
    if(!ad)throw fail(404,'广告体验记录不存在');
    if(ad.claimed)throw fail(409,'该奖励已领取');
    if(now()-ad.created_at<8000){risk(req.uid,'ad_claim','premature_claim');throw fail(409,'请完成演示后再领取');}
    if(now()-ad.created_at>600000||ad.day!==dayKey(now()))throw fail(410,'体验已过期，请重新开始');
    if(profile(req.uid).adCount>=5){risk(req.uid,'ad_claim','daily_limit');throw fail(429,'今日奖励已达上限');}
    return tx(()=>{
      db.prepare('UPDATE ad_sessions SET claimed=1 WHERE id=?').run(ad.id);
      ledger(req.uid,30,'ad','广告体验奖励（演示）','ad:'+ad.id);
      return {reward:30,user:profile(req.uid)};
    });
  });
  app.post('/api/orders',{preHandler:auth,schema:{body:bodySchema({productId:{type:'string',minLength:1,maxLength:64},requestKey:keySchema})}},async(req,reply)=>{
    const {productId,requestKey}=req.body;
    const existing=db.prepare('SELECT * FROM orders WHERE user_id=? AND request_key=?').get(req.uid,requestKey);
    if(existing){if(existing.product_id!==productId)throw fail(409,'请求标识已用于其他商品');return {order:existing,user:profile(req.uid),replayed:true};}
    allowReward(req.uid,'redeem');
    const p=db.prepare('SELECT * FROM products WHERE id=?').get(productId);
    if(!p)throw fail(404,'商品不存在');
    const count=db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND created_at>=?').get(req.uid,now()-3600000).n;
    if(count>=10){risk(req.uid,'redeem','hourly_limit');throw fail(429,'兑换过于频繁，请稍后再试');}
    const order=tx(()=>{
      if(!db.prepare('UPDATE products SET stock=stock-1 WHERE id=? AND stock>0').run(p.id).changes)throw fail(409,'商品库存不足');
      const id=randomUUID();ledger(req.uid,-p.points,'redeem','兑换 · '+p.name,'order:'+id);
      db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)').run(id,req.uid,p.id,p.name,p.points,'demo_reserved',requestKey,now());
      if(p.id==='coupon')db.prepare('INSERT INTO user_coupons VALUES(?,?,?,?,?,NULL,?)').run(randomUUID(),req.uid,2000,20000,now()+30*86400000,id);
      return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    });
    reply.code(201);return {order,user:profile(req.uid)};
  });
  app.get('/api/orders',{preHandler:auth},async req=>({items:db.prepare('SELECT id,product_id,name,points,status,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.uid)}));
  app.get('/api/admin/overview',{preHandler:admin},async()=>({
    mode,stats:{users:db.prepare('SELECT COUNT(*) AS n FROM users').get().n,orders:db.prepare('SELECT (SELECT COUNT(*) FROM orders)+(SELECT COUNT(*) FROM shop_orders) AS n').get().n,issued:db.prepare('SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE delta>0').get().n,adViews:db.prepare('SELECT COUNT(*) AS n FROM ad_sessions WHERE claimed=1').get().n},
    adsEnabled:db.prepare('SELECT value FROM settings WHERE key=?').get('ads_enabled').value==='true',
    placements:db.prepare('SELECT * FROM placements').all(),
    blockedUsers:db.prepare('SELECT * FROM blocked_users').all(),
    risks:db.prepare('SELECT * FROM risk_events ORDER BY created_at DESC LIMIT 30').all(),
    audits:db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 20').all(),
    integrations:[{name:'穿山甲 / 微信广告',status:'待平台审核与 SDK 接入'},{name:'数美风控',status:'未接入，当前为本地规则'},{name:'支付与物流',status:'未接入，不收款、不发货'}]
  }));
  app.post('/api/admin/settings',{preHandler:admin,schema:{body:bodySchema({adsEnabled:{type:'boolean'}})}},async req=>tx(()=>{
    db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(req.body.adsEnabled),'ads_enabled');
    db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(),'ads.toggle',JSON.stringify(req.body),now());return {ok:true};
  }));
  app.post('/api/admin/placements',{preHandler:admin,schema:{body:bodySchema({id:{type:'string',maxLength:64},enabled:{type:'boolean'}})}},async req=>tx(()=>{
    if(!db.prepare('UPDATE placements SET enabled=? WHERE id=?').run(Number(req.body.enabled),req.body.id).changes)throw fail(404,'广告位不存在');
    db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(),'placement.toggle',JSON.stringify(req.body),now());return {ok:true};
  }));
  app.post('/api/admin/restrictions',{preHandler:admin,schema:{body:bodySchema({userId:{type:'string',format:'uuid'},blocked:{type:'boolean'},reason:{type:'string',minLength:3,maxLength:200}})}},async req=>tx(()=>{
    if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(req.body.userId))throw fail(404,'账户不存在');
    if(req.body.blocked)db.prepare('INSERT INTO blocked_users VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at').run(req.body.userId,req.body.reason,now());
    else db.prepare('DELETE FROM blocked_users WHERE user_id=?').run(req.body.userId);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(),'account.restrict',JSON.stringify(req.body),now());return {ok:true};
  }));
  registerCommerce({app,db,now,auth,admin,tx,ledger,allowReward,profile});
  return app;
}
