import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.mjs';

async function fixture(t){
 const adminToken='operations-test-admin-token-0123456789';
 const app=await buildApp({dbPath:':memory:',adminToken});t.after(()=>app.close());
 const inject=(method,url,payload,token,admin=false)=>app.inject({method,url,payload,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(admin?{'x-admin-token':adminToken}:{})}});
 const admin=(method,url,payload)=>inject(method,url,payload,undefined,true);
 async function login(){const r=await inject('POST','/api/auth/demo',{consent:true});assert.equal(r.statusCode,201);return r.json()}
 const user=await login(),call=(method,url,payload)=>inject(method,url,payload,user.token);
 const address=(await call('POST','/api/addresses',{recipient:'测试用户',phone:'13800000000',detail:'测试省测试市演示地址 1 号'})).json();let seq=0;
 const checkout=async(productId='headphones',quantity=1,couponId='')=>call('POST','/api/shop/checkout',{items:[{productId,quantity}],addressId:address.id,couponId,requestKey:'operations-checkout-'+(++seq)});
 const product=async id=>(await admin('GET','/api/admin/products')).json().items.find(p=>p.id===id);
 const savePayload=p=>Object.fromEntries(['id','version','name','subtitle','category','price','points','stock','art','badge','enabled'].map(k=>[k,p[k]]));
 const me=async()=>(await call('GET','/api/me')).json();
 const complete=async id=>{for(const action of ['demo-pay','demo-ship','receive'])assert.equal((await call('POST',`/api/shop/orders/${id}/${action}`,{})).statusCode,200)};
 return {app,admin,inject,user,login,call,checkout,product,savePayload,me,complete};
}

test('merchant product mutation requires admin, validates values and rejects stale stock versions',async t=>{
 const {admin,call,checkout,product,savePayload,app}=await fixture(t);const p=await product('cup');
 assert.equal((await call('GET','/api/admin/products')).statusCode,403);
 assert.equal((await call('POST','/api/admin/products/save',savePayload(p))).statusCode,403);
 assert.equal((await admin('POST','/api/admin/products/save',{...savePayload(p),stock:-1})).statusCode,400);
 assert.equal((await admin('POST','/api/admin/products/save',{...savePayload(p),price:9.9})).statusCode,400);
 assert.equal((await admin('POST','/api/admin/products/save',{...savePayload(p),name:' A '})).statusCode,400);
 assert.equal((await checkout('cup')).statusCode,201);
 const stocked=await product('cup');assert.equal(stocked.stock,59);assert.equal(stocked.version,p.version+1);
 assert.equal((await admin('POST','/api/admin/products/save',{...savePayload(p),stock:600})).statusCode,409);
 assert.equal((await product('cup')).stock,59);
 const next=await admin('POST','/api/admin/products/save',{...savePayload(stocked),name:'新的测试马克杯',enabled:false});assert.equal(next.statusCode,200);assert.equal(next.json().product.version,stocked.version+1);
 assert.equal((await call('GET','/api/catalog')).json().products.some(p=>p.id==='cup'),false);
 assert.equal((await checkout('cup')).statusCode,404);
 assert.equal((await call('POST','/api/orders',{productId:'cup',requestKey:'disabled-redemption-12345'})).statusCode,404);
 assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='product.update'").get().n,1);
});

test('merchant creates products, all inventory lifecycle mutations update versions and new artwork is restricted',async t=>{
 const {admin,call,checkout,product,savePayload}=await fixture(t);const source=savePayload(await product('cup'));
 const create={...source,id:'',version:0,name:'新商品测试',stock:7};
 assert.equal((await admin('POST','/api/admin/products/save',{...create,art:'../../secret'})).statusCode,400);
 const created=await admin('POST','/api/admin/products/save',create);assert.equal(created.statusCode,201);assert.equal(created.json().product.stock,7);assert.equal(created.json().product.version,1);
 const id=created.json().product.id;
 const o=(await checkout(id)).json().order;assert.equal((await product(id)).version,2);
 await call('POST',`/api/shop/orders/${o.id}/cancel`,{});assert.equal((await product(id)).version,3);
 await call('POST',`/api/shop/orders/${o.id}/cancel`,{});assert.equal((await product(id)).version,3);
 assert.equal((await admin('POST','/api/admin/products/save',{...source,id:'coupon',version:1,price:100})).statusCode,400);
});

test('reward rules are server derived and existing orders retain their checkout snapshot',async t=>{
 const {admin,call,checkout,complete,me}=await fixture(t);
 assert.deepEqual((await call('GET','/api/points-rules')).json(),{purchasePointsPerYuan:1});
 assert.equal((await call('POST','/api/admin/points-rules',{purchasePointsPerYuan:9})).statusCode,403);
 assert.equal((await admin('POST','/api/admin/points-rules',{purchasePointsPerYuan:1.5})).statusCode,400);
 assert.equal((await admin('POST','/api/admin/points-rules',{purchasePointsPerYuan:11})).statusCode,400);
 const old=(await checkout()).json().order;
 assert.equal((await admin('POST','/api/admin/points-rules',{purchasePointsPerYuan:2})).statusCode,200);
 assert.equal((await call('GET','/api/catalog')).json().products.find(p=>p.id==='headphones').rewardPoints,598);
 const recent=(await checkout('cup')).json().order;assert.equal(recent.reward,198);
 await complete(old.id);assert.equal((await me()).points,299);
 await complete(recent.id);assert.equal((await me()).points,497);
});

test('merchant shipping validates authorization and states and records consistent replay exactly once',async t=>{
 const {admin,call,checkout,inject,login,app}=await fixture(t);const o=(await checkout()).json().order;const info={carrier:'测试快递',tracking:'TEST123456789'};
 assert.equal((await call('POST',`/api/admin/shop-orders/${o.id}/ship`,info)).statusCode,403);
 assert.equal((await admin('POST',`/api/admin/shop-orders/${o.id}/ship`,info)).statusCode,409);
 await call('POST',`/api/shop/orders/${o.id}/demo-pay`,{});
 assert.equal((await admin('POST',`/api/admin/shop-orders/${o.id}/ship`,{carrier:'   ',tracking:'A    '})).statusCode,400);
 const first=await admin('POST',`/api/admin/shop-orders/${o.id}/ship`,info);assert.equal(first.statusCode,200);assert.equal(first.json().order.status,'shipped');assert.equal(first.json().actuallyShipped,false);
 const second=await admin('POST',`/api/admin/shop-orders/${o.id}/ship`,info);assert.equal(second.json().replayed,true);
 assert.equal((await admin('POST',`/api/admin/shop-orders/${o.id}/ship`,{...info,tracking:'DIFFERENT123'})).statusCode,409);
 const mine=(await call('GET','/api/shop/orders')).json().items[0];assert.equal(mine.shipment.carrier,info.carrier);assert.equal(mine.shipment.tracking,info.tracking);
 const b=await login();assert.equal((await inject('GET','/api/shop/orders',undefined,b.token)).json().items.length,0);
 assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='order.ship'").get().n,1);
});

test('after-sale requests are owner-scoped, freeze fulfillment, and rejection is audited and replay-safe',async t=>{
 const {admin,call,checkout,inject,login,app}=await fixture(t);const o=(await checkout()).json().order;const base=`/api/shop/orders/${o.id}`;
 assert.equal((await call('POST',base+'/after-sales',{reason:'申请测试售后退款'})).statusCode,409);
 await call('POST',base+'/demo-pay',{});
 const b=await login();assert.equal((await inject('POST',base+'/after-sales',{reason:'申请测试售后退款'},b.token)).statusCode,404);
 const request=await call('POST',base+'/after-sales',{reason:'申请测试售后退款'});assert.equal(request.statusCode,201);const id=request.json().afterSale.id;
 assert.equal((await call('POST',base+'/after-sales',{reason:'第二次点击重复申请'})).json().afterSale.id,id);
 assert.equal((await call('POST',base+'/refund',{})).statusCode,409);
 assert.equal((await call('POST',base+'/demo-ship',{})).statusCode,409);
 assert.equal((await admin('POST',`/api/admin/shop-orders/${o.id}/ship`,{carrier:'测试快递',tracking:'TEST12345'})).statusCode,409);
 assert.equal((await call('POST',base+'/receive',{})).statusCode,409);
 assert.equal((await call('GET','/api/admin/after-sales')).statusCode,403);
 assert.equal((await call('POST',`/api/admin/after-sales/${id}/resolve`,{decision:'reject',note:'测试驳回原因'})).statusCode,403);
 const body={decision:'reject',note:'测试驳回原因'};
 assert.equal((await admin('POST',`/api/admin/after-sales/${id}/resolve`,body)).json().afterSale.status,'rejected');
 assert.equal((await admin('POST',`/api/admin/after-sales/${id}/resolve`,body)).json().replayed,true);
 assert.equal((await admin('POST',`/api/admin/after-sales/${id}/resolve`,{decision:'approve',note:'改为测试批准'})).statusCode,409);
 assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='after_sale.resolve'").get().n,1);
 const queue=(await admin('GET','/api/admin/after-sales')).json().items;assert.equal(queue[0].orderId,o.id);assert.equal(queue[0].orderNumber,o.number);assert.ok(queue[0].items.length);
});

test('approved after-sales atomically recovers awarded points, inventory and coupons without duplicate refunds',async t=>{
 const {admin,call,checkout,complete,me,product}=await fixture(t);const o=(await checkout()).json().order;await complete(o.id);assert.equal((await me()).points,299);
 const request=(await call('POST',`/api/shop/orders/${o.id}/after-sales`,{reason:'确认收货后测试退款'})).json().afterSale;
 const decision={decision:'approve',note:'核验通过批准测试退款'};
 for(let i=0;i<2;i++){const r=await admin('POST',`/api/admin/after-sales/${request.id}/resolve`,decision);assert.equal(r.statusCode,200);assert.equal(r.json().actuallyRefunded,false);}
 assert.equal((await me()).points,0);assert.equal((await product('headphones')).stock,28);
 const rows=(await call('GET','/api/ledger')).json().items;assert.equal(rows.length,2);assert.equal(rows.reduce((n,l)=>n+l.delta,0),0);
 const current=(await call('GET','/api/shop/orders')).json().items[0];assert.equal(current.status,'refunded');assert.equal(current.afterSale.status,'approved');
});

test('approval before receipt restores a locked coupon and stock but never awards pending points',async t=>{
 const {admin,call,checkout,complete,me,product}=await fixture(t);
 const funded=(await checkout('headphones',2)).json().order;await complete(funded.id);
 const couponBefore=await product('coupon');
 const redeemed=await call('POST','/api/orders',{productId:'coupon',requestKey:'after-sale-coupon-redemption-1234'});assert.equal(redeemed.statusCode,201);
 assert.equal((await product('coupon')).version,couponBefore.version+1);
 const coupon=(await call('GET','/api/coupons')).json().items[0];
 const discounted=(await checkout('headphones',1,coupon.id)).json().order;
 await call('POST',`/api/shop/orders/${discounted.id}/demo-pay`,{});
 assert.equal((await me()).pendingPoints,279);
 const request=(await call('POST',`/api/shop/orders/${discounted.id}/after-sales`,{reason:'付款后未收货测试退款'})).json().afterSale;
 const decision={decision:'approve',note:'未发货订单同意测试退款'};
 assert.equal((await admin('POST',`/api/admin/after-sales/${request.id}/resolve`,decision)).statusCode,200);
 assert.equal((await me()).points,298);assert.equal((await me()).pendingPoints,0);
 assert.equal((await call('GET','/api/coupons')).json().items[0].status,'available');
 assert.equal((await product('headphones')).stock,26);
 assert.equal((await admin('POST',`/api/admin/after-sales/${request.id}/resolve`,decision)).json().replayed,true);
 assert.equal((await product('headphones')).stock,26);
});

test('insufficient awarded points keeps approval pending and preserves all accounting',async t=>{
 const {admin,call,checkout,complete,me,product}=await fixture(t);const o=(await checkout('headphones',2)).json().order;await complete(o.id);
 await call('POST','/api/orders',{productId:'coupon',requestKey:'spend-returned-points-before-review'});
 const request=(await call('POST',`/api/shop/orders/${o.id}/after-sales`,{reason:'积分使用之后申请测试退款'})).json().afterSale;
 assert.equal((await admin('POST',`/api/admin/after-sales/${request.id}/resolve`,{decision:'approve',note:'测试余额不足的批准操作'})).statusCode,409);
 assert.equal((await me()).points,298);assert.equal((await product('headphones')).stock,26);
 assert.equal((await admin('GET','/api/admin/after-sales')).json().items[0].status,'pending');
 assert.equal((await call('GET','/api/shop/orders')).json().items[0].status,'completed');
});

test('additive migration preserves old stock and merchant edits across reopening',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'aurora-migration-')),path=join(dir,'db.sqlite');let app;
 t.after(async()=>{if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
 const old=new DatabaseSync(path);
 old.exec('CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT NOT NULL,subtitle TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,points INTEGER NOT NULL,stock INTEGER NOT NULL,art TEXT NOT NULL,color TEXT NOT NULL,badge TEXT NOT NULL)');
 old.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?)').run('cup','用户自定义杯子','用户描述不应被覆盖','生活美学',12300,123,3,'cup','#fff','自定义');old.close();
 app=await buildApp({dbPath:path});let p=app.db.prepare('SELECT * FROM products WHERE id=?').get('cup');assert.equal(p.name,'用户自定义杯子');assert.equal(p.stock,3);assert.equal(p.version,1);assert.equal(p.enabled,1);
 app.db.prepare('UPDATE products SET enabled=0,version=5 WHERE id=?').run('cup');await app.close();app=undefined;
 app=await buildApp({dbPath:path});p=app.db.prepare('SELECT * FROM products WHERE id=?').get('cup');assert.equal(p.stock,3);assert.equal(p.version,5);assert.equal(p.enabled,0);
});

test('order CSV export is admin-only, bounded, private and spreadsheet-safe',async t=>{
 const {admin,call,checkout,app}=await fixture(t);
 const url='/api/admin/shop-orders/export.csv';
 assert.equal((await call('GET',url)).statusCode,403);
 for(const query of ['limit=0','limit=1001','limit=1.5','status=unknown'])assert.equal((await admin('GET',`${url}?${query}`)).statusCode,400);
 const first=(await checkout('headphones')).json().order;
 const second=(await checkout('cup')).json().order;
 app.db.prepare('UPDATE shop_items SET name=? WHERE order_id=?').run('  =HYPERLINK("bad")\r\n测试,商品',first.id);
 await call('POST',`/api/shop/orders/${first.id}/demo-pay`,{});
 assert.equal((await admin('POST',`/api/admin/shop-orders/${first.id}/ship`,{carrier:'@恶意公式',tracking:'TEST12345'})).statusCode,200);
 const result=await admin('GET',`${url}?status=shipped&limit=1`);
 assert.equal(result.statusCode,200);
 assert.match(result.headers['content-type'],/^text\/csv; charset=utf-8/);
 assert.match(result.headers['content-disposition'],/attachment/);
 assert.equal(result.headers['cache-control'],'no-store');
 assert.ok(result.body.startsWith('\uFEFF'));
 assert.ok(result.body.includes(first.number));assert.ok(!result.body.includes(second.number));
 assert.ok(result.body.includes('"\'  =HYPERLINK(""bad"")\r\n测试,商品 × 1"'));
 assert.ok(result.body.includes('"\'@恶意公式"'));
 assert.ok(result.body.includes('"299.00"'));
 for(const privateValue of ['13800000000','测试省测试市演示地址','address_json','request_key','fingerprint'])assert.ok(!result.body.includes(privateValue));
 const audit=app.db.prepare("SELECT detail FROM audit WHERE action='order.export'").all();
 assert.equal(audit.length,1);assert.deepEqual(JSON.parse(audit[0].detail),{count:1,limit:1,status:'shipped'});
 const bounded=await admin('GET',`${url}?limit=1`);
 assert.equal(bounded.statusCode,200);assert.equal(JSON.parse(app.db.prepare("SELECT detail FROM audit WHERE action='order.export' ORDER BY rowid DESC LIMIT 1").get().detail).count,1);
 const copy=app.db.prepare('INSERT INTO shop_orders SELECT ?,user_id,?,amount,reward,status,?,fingerprint,address_json,coupon_id,created_at FROM shop_orders WHERE id=?');
 for(let i=0;i<105;i++)copy.run(`export-test-${i}`,`EXPORT-TEST-${i}`,`export-key-${i}`,second.id);
 const defaults=await admin('GET',`${url}?status=pending`);
 assert.equal(defaults.statusCode,200);assert.equal(defaults.body.split('\r\n').length,102);
 const allBounded=await admin('GET',`${url}?status=pending&limit=1000`);
 assert.equal(allBounded.statusCode,200);assert.equal(allBounded.body.split('\r\n').length,108);
});
