import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.mjs';

async function fixture(t){
 const adminToken='redemption-test-admin-token-0123456789';
 const app=await buildApp({dbPath:':memory:',adminToken});t.after(()=>app.close());
 const inject=(method,url,payload,headers={})=>app.inject({method,url,payload,headers});
 const admin=(method,url,payload)=>inject(method,url,payload,{'x-admin-token':adminToken});
 const user=(await inject('POST','/api/auth/demo',{consent:true})).json();
 const other=(await inject('POST','/api/auth/demo',{consent:true})).json();
 const call=(method,url,payload)=>inject(method,url,payload,{authorization:`Bearer ${user.token}`});
 app.db.prepare('UPDATE users SET points=5000 WHERE id=?').run(user.user.id);
 const redeem=async(productId,requestKey)=>{
  const response=await call('POST','/api/orders',{productId,requestKey});assert.equal(response.statusCode,201);return response.json().order;
 };
 return {app,admin,call,inject,user,other,redeem};
}

test('redemption processing is admin-only, audited and does not repeat inventory or points changes',async t=>{
 const {app,admin,call,redeem,user,other,inject}=await fixture(t);
 const order=await redeem('cup','redemption-process-test-001');
 const before={points:app.db.prepare('SELECT points FROM users WHERE id=?').get(user.user.id).points,stock:app.db.prepare("SELECT stock FROM products WHERE id='cup'").get().stock};
 assert.equal((await call('GET','/api/admin/redemptions')).statusCode,403);
 assert.equal((await call('POST',`/api/admin/redemptions/${order.id}/fulfill`,{note:'不能自行处理'})).statusCode,403);
 const list=(await admin('GET','/api/admin/redemptions')).json().items;
 assert.equal(list.length,1);assert.equal(list[0].id,order.id);assert.equal(list[0].fulfillment,null);
 const first=await admin('POST',`/api/admin/redemptions/${order.id}/fulfill`,{note:'  测试兑换已核对，未实际发货  '});
 assert.equal(first.statusCode,200);assert.equal(first.json().replayed,false);
 assert.equal(first.json().order.fulfillment.note,'测试兑换已核对，未实际发货');
 const replay=await admin('POST',`/api/admin/redemptions/${order.id}/fulfill`,{note:'测试兑换已核对，未实际发货'});
 assert.equal(replay.statusCode,200);assert.equal(replay.json().replayed,true);
 assert.equal((await admin('POST',`/api/admin/redemptions/${order.id}/fulfill`,{note:'覆盖原始说明'})).statusCode,409);
 assert.deepEqual({points:app.db.prepare('SELECT points FROM users WHERE id=?').get(user.user.id).points,stock:app.db.prepare("SELECT stock FROM products WHERE id='cup'").get().stock},before);
 assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='redemption.fulfill'").get().n,1);
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM redemption_fulfillments').get().n,1);
 assert.equal(app.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'demo_reserved');
 const own=(await call('GET','/api/orders')).json().items;assert.equal(own[0].fulfillment.note,'测试兑换已核对，未实际发货');
 const foreign=await inject('GET','/api/orders',undefined,{authorization:`Bearer ${other.token}`});assert.deepEqual(foreign.json().items,[]);
});

test('redemption processing rejects automatic coupons, invalid states, invalid notes and unknown orders',async t=>{
 const {app,admin,redeem}=await fixture(t);
 const coupon=await redeem('coupon','redemption-coupon-test-001');
 assert.equal((await admin('POST',`/api/admin/redemptions/${coupon.id}/fulfill`,{note:'重复发放购物券'})).statusCode,409);
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM user_coupons WHERE redemption_id=?').get(coupon.id).n,1);
 const order=await redeem('cup','redemption-state-test-001');
 for(const note of ['  ','x'.repeat(301)])assert.equal((await admin('POST',`/api/admin/redemptions/${order.id}/fulfill`,{note})).statusCode,400);
 assert.equal((await admin('POST',`/api/admin/redemptions/${order.id}/fulfill`,{note:'有效说明',extra:'invalid'})).statusCode,400);
 app.db.prepare("UPDATE orders SET status='closed' WHERE id=?").run(order.id);
 assert.equal((await admin('POST',`/api/admin/redemptions/${order.id}/fulfill`,{note:'不能处理关闭记录'})).statusCode,409);
 assert.equal((await admin('POST','/api/admin/redemptions/00000000-0000-4000-8000-000000000000/fulfill',{note:'未知订单'})).statusCode,404);
 assert.equal((await admin('POST','/api/admin/redemptions/invalid/fulfill',{note:'未知订单'})).statusCode,400);
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM redemption_fulfillments').get().n,0);
});
