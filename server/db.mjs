import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const products = [
  {id:'headphones',name:'声屿 · 头戴式立体声耳机',subtitle:'把喧嚣留在世界之外',category:'数码好物',price:29900,points:1200,stock:28,art:'headphones',color:'#a7a0ff',badge:'人气精选'},
  {id:'lamp',name:'月弧 · 极简阅读台灯',subtitle:'为每一个夜晚，留一束温柔',category:'生活美学',price:16900,points:800,stock:42,art:'lamp',color:'#eac59c',badge:'编辑之选'},
  {id:'speaker',name:'漫游 · 便携音箱',subtitle:'好音乐，随你去任何地方',category:'数码好物',price:22900,points:1000,stock:35,art:'speaker',color:'#9cd3bc',badge:'新品上架'},
  {id:'cup',name:'山野 · 日用陶瓷马克杯',subtitle:'让生活慢下来的一小口',category:'生活美学',price:9900,points:500,stock:60,art:'cup',color:'#aac4e7',badge:'轻松兑换'},
  {id:'bag',name:'轻旅 · 城市通勤双肩包',subtitle:'装下日常，也装下灵感',category:'出行装备',price:19900,points:900,stock:22,art:'bag',color:'#e3adbd',badge:'质感日常'},
  {id:'mouse',name:'灵点 · 桌面办公鼠标',subtitle:'让每一次操作，都轻松一点',category:'数码好物',price:12900,points:600,stock:45,art:'mouse',color:'#d9dfe6',badge:'桌面精选'},
  {id:'coupon',name:'曜集 · 20 元购物券',subtitle:'满 200 元可用，有效期 30 天',category:'专属权益',price:0,points:300,stock:999,art:'coupon',color:'#d6c38a',badge:'会员专享'}
];
export function openDb(path){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0 CHECK(points>=0), created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),delta INTEGER NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,event_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS checkins(user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,PRIMARY KEY(user_id,day));
  CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,subtitle TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,points INTEGER NOT NULL,stock INTEGER NOT NULL CHECK(stock>=0),art TEXT NOT NULL,color TEXT NOT NULL,badge TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,points INTEGER NOT NULL,status TEXT NOT NULL,request_key TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,request_key));
  CREATE TABLE IF NOT EXISTS ad_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,day TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS risk_events(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,action TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS placements(id TEXT PRIMARY KEY,name TEXT NOT NULL,position TEXT NOT NULL,format TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS blocked_users(user_id TEXT PRIMARY KEY REFERENCES users(id),reason TEXT NOT NULL,created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS ledger_user_time ON ledger(user_id,created_at);
  CREATE INDEX IF NOT EXISTS orders_user_time ON orders(user_id,created_at);
  CREATE INDEX IF NOT EXISTS ads_user_day ON ad_sessions(user_id,day);
  CREATE INDEX IF NOT EXISTS risk_time ON risk_events(created_at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS cart(user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),PRIMARY KEY(user_id,product_id));
  CREATE TABLE IF NOT EXISTS addresses(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),recipient TEXT NOT NULL,phone TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS shop_orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),number TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL,reward INTEGER NOT NULL,status TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,address_json TEXT NOT NULL,coupon_id TEXT,created_at INTEGER NOT NULL,UNIQUE(user_id,request_key));
  CREATE TABLE IF NOT EXISTS shop_items(order_id TEXT NOT NULL REFERENCES shop_orders(id),product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,price INTEGER NOT NULL,quantity INTEGER NOT NULL,art TEXT NOT NULL,PRIMARY KEY(order_id,product_id));
  CREATE TABLE IF NOT EXISTS user_coupons(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),discount INTEGER NOT NULL,threshold INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_order TEXT,redemption_id TEXT NOT NULL UNIQUE);
  CREATE INDEX IF NOT EXISTS shop_user_time ON shop_orders(user_id,created_at);`);
  const insert=db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?,?,?,?,?,?,?)');
  for(const p of products)insert.run(p.id,p.name,p.subtitle,p.category,p.price,p.points,p.stock,p.art,p.color,p.badge);
  // Rename only the known original demonstration rows; preserve merchant customizations.
  for(const [oldName,newName] of [['声屿 · 无线降噪耳机','声屿 · 头戴式立体声耳机'],['月弧 · 氛围台灯','月弧 · 极简阅读台灯'],['山野 · 随行保温杯','山野 · 日用陶瓷马克杯'],['轻旅 · 城市通勤包','轻旅 · 城市通勤双肩包']])db.prepare('UPDATE products SET name=? WHERE name=?').run(newName,oldName);
  db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('ads_enabled','true');
  const placement=db.prepare('INSERT OR IGNORE INTO placements VALUES(?,?,?,?,0)');
  for(const p of [
    ['home_feature','首页品牌精选','home','banner'],['home_feed','商城信息流','shop','feed'],
    ['task_reward','任务激励视频','tasks','rewarded'],['product_detail','商品详情推荐','product','banner'],
    ['member_benefit','会员权益推荐','mine','banner']
  ])placement.run(...p);
  return db;
}
