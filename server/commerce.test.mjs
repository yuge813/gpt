import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.mjs';
async function setup(t){
 const app=await buildApp({dbPath:':memory:'});t.after(()=>app.close());
 const inject=(method,url,payload,token)=>app.inject({method,url,payload,headers:token?{authorization:`Bearer ${token}`}:{}});
 async function login(){return (await inject('POST','/api/auth/demo',{consent:true})).json()}
 const a=await login();const token=a.token;
 const call=(method,url,payload)=>inject(method,url,payload,token);
 const address=(await call('POST','/api/addresses',{recipient:'测试用户',phone:'13800000000',detail:'测试省测试市演示路 1 号'})).json();
 let i=0;
 const checkout=async(productId='headphones',quantity=1,couponId='')=>call('POST','/api/shop/checkout',{items:[{productId,quantity}],addressId:address.id,couponId,requestKey:'checkout-unique-key-'+(++i)});
 async function complete(id){for(const action of ['demo-pay','demo-ship','receive'])assert.equal((await call('POST',`/api/shop/orders/${id}/${action}`,{})).statusCode,200)}
 const me=async()=>(await call('GET','/api/me')).json();
 return {app,a,call,inject,login,checkout,complete,me,address};
}
test('shopping awards nothing at checkout or payment, awards once on receipt and revokes once on refund',async t=>{
 const {call,checkout,complete,me,app}=await setup(t);
 assert.equal((await me()).points,0);
 const r=await checkout();assert.equal(r.statusCode,201);const o=r.json().order;assert.equal(o.amount,29900);assert.equal(o.reward,299);
 assert.equal((await me()).points,0);
 await call('POST',`/api/shop/orders/${o.id}/demo-pay`,{});assert.equal((await me()).pendingPoints,299);assert.equal((await me()).points,0);
 await complete(o.id);await call('POST',`/api/shop/orders/${o.id}/receive`,{});assert.equal((await me()).points,299);assert.equal((await me()).pendingPoints,0);
 const rows=(await call('GET','/api/ledger')).json().items;assert.equal(rows.length,1);assert.equal(rows[0].kind,'purchase');
 for(let i=0;i<2;i++)assert.equal((await call('POST',`/api/shop/orders/${o.id}/refund`,{})).statusCode,200);
 assert.equal((await me()).points,0);assert.equal(app.db.prepare('SELECT stock FROM products WHERE id=?').get('headphones').stock,28);
});
test('checkout deduplicates concurrent requests, trusts server prices and restocks cancelled orders only once',async t=>{
 const {call,address,app}=await setup(t);const payload={items:[{productId:'cup',quantity:2}],addressId:address.id,couponId:'',requestKey:'same-checkout-request-1234'};
 const responses=await Promise.all(Array.from({length:4},()=>call('POST','/api/shop/checkout',payload)));
 assert.equal(responses.filter(r=>r.statusCode===201).length,1);const o=responses[0].json().order;assert.equal(o.amount,19800);
 assert.equal((await call('POST','/api/shop/checkout',{...payload,amount:1})).statusCode,400);
 assert.equal((await call('POST','/api/shop/checkout',{...payload,items:[{productId:'cup',quantity:1}]})).statusCode,409);
 for(let i=0;i<2;i++)assert.equal((await call('POST',`/api/shop/orders/${o.id}/cancel`,{})).statusCode,200);
 assert.equal(app.db.prepare('SELECT stock FROM products WHERE id=?').get('cup').stock,60);
 assert.equal((await call('POST',`/api/shop/orders/${o.id}/demo-pay`,{})).statusCode,409);
});
test('cart, addresses and orders are isolated between users; impossible state transitions rejected',async t=>{
 const {call,checkout,inject,login}=await setup(t);const b=await login();
 assert.equal((await call('POST','/api/cart',{productId:'cup',quantity:2})).statusCode,200);
 assert.equal((await inject('GET','/api/cart',undefined,b.token)).json().items.length,0);
 assert.equal((await inject('GET','/api/addresses',undefined,b.token)).json().items.length,0);
 const o=(await checkout()).json().order;
 for(const action of ['demo-pay','demo-ship','receive','cancel','refund'])assert.equal((await inject('POST',`/api/shop/orders/${o.id}/${action}`,{},b.token)).statusCode,404);
 assert.equal((await call('POST',`/api/shop/orders/${o.id}/receive`,{})).statusCode,409);
 assert.equal((await call('POST',`/api/shop/orders/${o.id}/refund`,{})).statusCode,409);
 assert.equal((await inject('GET','/api/shop/orders',undefined,b.token)).json().items.length,0);
});
test('purchase points can buy a coupon, coupon changes payable reward and is locked/restored atomically',async t=>{
 const {call,checkout,complete,me}=await setup(t);const initial=(await checkout('headphones',2)).json().order;await complete(initial.id);assert.equal((await me()).points,598);
 const redeem=await call('POST','/api/orders',{productId:'coupon',requestKey:'redeem-shopping-coupon-1234'});assert.equal(redeem.statusCode,201);assert.equal((await me()).points,298);
 const coupon=(await call('GET','/api/coupons')).json().items[0];assert.equal(coupon.status,'available');
 assert.equal((await checkout('cup',1,coupon.id)).statusCode,409);
 const discounted=(await checkout('headphones',1,coupon.id)).json().order;assert.equal(discounted.amount,27900);assert.equal(discounted.reward,279);
 assert.equal((await checkout('headphones',1,coupon.id)).statusCode,409);
 await call('POST',`/api/shop/orders/${discounted.id}/cancel`,{});assert.equal((await call('GET','/api/coupons')).json().items[0].status,'available');
 const final=(await checkout('headphones',1,coupon.id)).json().order;await complete(final.id);assert.equal((await me()).points,577);
});
test('refund after spending awarded points requires review and does not silently create negative balance',async t=>{
 const {call,checkout,complete,me}=await setup(t);const o=(await checkout('headphones',2)).json().order;await complete(o.id);
 await call('POST','/api/orders',{productId:'coupon',requestKey:'spend-points-before-refund'});
 assert.equal((await call('POST',`/api/shop/orders/${o.id}/refund`,{})).statusCode,409);assert.equal((await me()).points,298);
 assert.equal((await call('GET','/api/shop/orders')).json().items[0].status,'completed');
});
test('multi-item checkout rollback preserves all stock on missing goods and blocks foreign addresses',async t=>{
 const {call,address,app,inject,login}=await setup(t);const b=await login();
 const payload={items:[{productId:'cup',quantity:1},{productId:'missing',quantity:1}],addressId:address.id,couponId:'',requestKey:'rollback-missing-product-123'};
 assert.equal((await call('POST','/api/shop/checkout',payload)).statusCode,404);
 assert.equal(app.db.prepare('SELECT stock FROM products WHERE id=?').get('cup').stock,60);
 assert.equal((await inject('POST','/api/shop/checkout',{...payload,items:[{productId:'cup',quantity:1}]},b.token)).statusCode,400);
});
