import { randomUUID, createHash } from 'node:crypto';
const error=(code,message)=>Object.assign(new Error(message),{statusCode:code});
const schema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const uuid={type:'string',format:'uuid'};
const key={type:'string',minLength:16,maxLength:128,pattern:'^[a-zA-Z0-9_-]+$'};
const line={type:'object',additionalProperties:false,properties:{productId:{type:'string',minLength:1,maxLength:64},quantity:{type:'integer',minimum:1,maximum:20}},required:['productId','quantity']};
export function registerCommerce({app,db,now,auth,admin,tx,ledger,allowReward,profile}){
  const items=id=>db.prepare('SELECT product_id,name,price,quantity,art FROM shop_items WHERE order_id=?').all(id);
  const owned=(id,uid)=>{const o=db.prepare('SELECT * FROM shop_orders WHERE id=? AND user_id=?').get(id,uid);if(!o)throw error(404,'订单不存在');return o;};
  const order=o=>({...o,items:items(o.id),address:JSON.parse(o.address_json),address_json:undefined,fingerprint:undefined,request_key:undefined});
  const settings={preHandler:auth};
  app.get('/api/cart',settings,async req=>({items:db.prepare('SELECT p.*,c.quantity FROM cart c JOIN products p ON p.id=c.product_id WHERE c.user_id=?').all(req.uid)}));
  app.post('/api/cart',{...settings,schema:{body:schema(line.properties)}},async req=>{
    const p=db.prepare('SELECT * FROM products WHERE id=? AND price>0').get(req.body.productId);
    if(!p)throw error(404,'商品不存在或仅支持积分兑换');
    if(req.body.quantity>p.stock)throw error(409,'库存不足');
    db.prepare('INSERT INTO cart VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity').run(req.uid,p.id,req.body.quantity);return {ok:true};
  });
  app.post('/api/cart/remove',{...settings,schema:{body:schema({productId:{type:'string',maxLength:64}})}},async req=>{db.prepare('DELETE FROM cart WHERE user_id=? AND product_id=?').run(req.uid,req.body.productId);return {ok:true};});
  app.get('/api/addresses',settings,async req=>({items:db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY created_at DESC').all(req.uid)}));
  app.post('/api/addresses',{...settings,schema:{body:schema({recipient:{type:'string',minLength:2,maxLength:30},phone:{type:'string',pattern:'^1[0-9]{10}$'},detail:{type:'string',minLength:5,maxLength:200}})}},async(req,reply)=>{
    if(db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id=?').get(req.uid).n>=20)throw error(409,'最多保存 20 个地址');
    const id=randomUUID();db.prepare('INSERT INTO addresses VALUES(?,?,?,?,?,?)').run(id,req.uid,req.body.recipient,req.body.phone,req.body.detail,now());reply.code(201);return {id};
  });
  app.post('/api/addresses/remove',{...settings,schema:{body:schema({id:uuid})}},async req=>{db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(req.body.id,req.uid);return {ok:true};});
  app.get('/api/coupons',settings,async req=>({items:db.prepare('SELECT * FROM user_coupons WHERE user_id=? ORDER BY expires_at').all(req.uid).map(c=>({...c,status:c.used_order?'used':c.expires_at<=now()?'expired':'available'}))}));
  app.post('/api/shop/checkout',{...settings,schema:{body:schema({items:{type:'array',minItems:1,maxItems:20,items:line},addressId:uuid,couponId:{type:'string',maxLength:36},requestKey:key})}},async(req,reply)=>{
    allowReward(req.uid,'purchase');
    const list=[...req.body.items].sort((a,b)=>a.productId.localeCompare(b.productId));
    if(new Set(list.map(x=>x.productId)).size!==list.length)throw error(400,'商品重复，请合并数量后提交');
    const fingerprint=createHash('sha256').update(JSON.stringify([list,req.body.addressId,req.body.couponId])).digest('hex');
    const existing=db.prepare('SELECT * FROM shop_orders WHERE user_id=? AND request_key=?').get(req.uid,req.body.requestKey);
    if(existing){if(existing.fingerprint!==fingerprint)throw error(409,'请求标识已用于其他订单');return {order:order(existing),replayed:true};}
    const address=db.prepare('SELECT recipient,phone,detail FROM addresses WHERE id=? AND user_id=?').get(req.body.addressId,req.uid);
    if(!address)throw error(400,'请选择自己的有效收货地址');
    if(db.prepare("SELECT COUNT(*) AS n FROM shop_orders WHERE user_id=? AND status='pending'").get(req.uid).n>=10)throw error(429,'待付款订单过多，请先取消或完成已有订单');
    const result=tx(()=>{
      const id=randomUUID();let amount=0;const snapshots=[];
      for(const input of list){
        const p=db.prepare('SELECT * FROM products WHERE id=? AND price>0').get(input.productId);
        if(!p)throw error(404,'商品不存在或仅支持积分兑换');
        if(!db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(input.quantity,p.id,input.quantity).changes)throw error(409,`${p.name} 库存不足`);
        amount+=p.price*input.quantity;snapshots.push({...p,quantity:input.quantity});
      }
      if(req.body.couponId){
        const c=db.prepare('SELECT * FROM user_coupons WHERE id=? AND user_id=? AND used_order IS NULL AND expires_at>?').get(req.body.couponId,req.uid,now());
        if(!c)throw error(409,'优惠券无效或已使用');
        if(amount<c.threshold)throw error(409,`订单需满 ${c.threshold/100} 元才可使用该券`);
        amount=Math.max(0,amount-c.discount);
        db.prepare('UPDATE user_coupons SET used_order=? WHERE id=?').run(id,c.id);
      }
      db.prepare('INSERT INTO shop_orders VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,req.uid,'YJ'+now().toString()+randomUUID().slice(0,6).toUpperCase(),amount,Math.floor(amount/100),'pending',req.body.requestKey,fingerprint,JSON.stringify(address),req.body.couponId||null,now());
      const insert=db.prepare('INSERT INTO shop_items VALUES(?,?,?,?,?,?)');
      for(const p of snapshots){insert.run(id,p.id,p.name,p.price,p.quantity,p.art);db.prepare('DELETE FROM cart WHERE user_id=? AND product_id=?').run(req.uid,p.id);}
      return owned(id,req.uid);
    });reply.code(201);return {order:order(result)};
  });
  app.get('/api/shop/orders',settings,async req=>({items:db.prepare('SELECT * FROM shop_orders WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(req.uid).map(order)}));
  const actionSchema={params:schema({id:uuid}),body:schema({})};
  app.post('/api/shop/orders/:id/demo-pay',{...settings,schema:actionSchema},async req=>{
    allowReward(req.uid,'demo_purchase');return tx(()=>{
      const o=owned(req.params.id,req.uid);
      if(o.status==='pending')db.prepare("UPDATE shop_orders SET status='paid' WHERE id=?").run(o.id);
      else if(!['paid','shipped','completed'].includes(o.status))throw error(409,'订单已关闭，不能付款');
      return {order:order(owned(o.id,req.uid)),paymentProvider:'demo',charged:false};
    });
  });
  app.post('/api/shop/orders/:id/demo-ship',{...settings,schema:actionSchema},async req=>tx(()=>{
    const o=owned(req.params.id,req.uid);
    if(o.status==='paid')db.prepare("UPDATE shop_orders SET status='shipped' WHERE id=?").run(o.id);
    else if(!['shipped','completed'].includes(o.status))throw error(409,'请先完成测试付款');
    return {order:order(owned(o.id,req.uid)),shippingProvider:'demo',actuallyShipped:false};
  }));
  app.post('/api/shop/orders/:id/receive',{...settings,schema:actionSchema},async req=>{
    allowReward(req.uid,'purchase_reward');return tx(()=>{
      const o=owned(req.params.id,req.uid);
      if(o.status!=='completed'){
        if(o.status!=='shipped')throw error(409,'订单尚未发货，不能确认收货');
        if(o.reward)ledger(req.uid,o.reward,'purchase','购物返积分 · '+o.number,'purchase:'+o.id);
        db.prepare("UPDATE shop_orders SET status='completed' WHERE id=?").run(o.id);
      }return {order:order(owned(o.id,req.uid)),user:profile(req.uid)};
    });
  });
  function restore(o){
    for(const p of items(o.id))db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(p.quantity,p.product_id);
    if(o.coupon_id)db.prepare('UPDATE user_coupons SET used_order=NULL WHERE id=? AND used_order=?').run(o.coupon_id,o.id);
  }
  app.post('/api/shop/orders/:id/cancel',{...settings,schema:actionSchema},async req=>tx(()=>{
    const o=owned(req.params.id,req.uid);
    if(o.status==='pending'){restore(o);db.prepare("UPDATE shop_orders SET status='cancelled' WHERE id=?").run(o.id);}
    else if(o.status!=='cancelled')throw error(409,'已付款订单请走售后退款');
    return {order:order(owned(o.id,req.uid))};
  }));
  app.post('/api/shop/orders/:id/refund',{...settings,schema:actionSchema},async req=>tx(()=>{
    const o=owned(req.params.id,req.uid);
    if(o.status==='refunded')return {order:order(o),user:profile(req.uid),actuallyRefunded:false};
    if(!['paid','shipped','completed'].includes(o.status))throw error(409,'当前订单不可退款');
    if(o.status==='completed'&&o.reward){
      if(profile(req.uid).points<o.reward)throw error(409,'已使用返还积分，需人工售后审核；本次未变更订单');
      ledger(req.uid,-o.reward,'purchase_refund','退款回收购物积分 · '+o.number,'refund:'+o.id);
    }
    restore(o);db.prepare("UPDATE shop_orders SET status='refunded' WHERE id=?").run(o.id);
    return {order:order(owned(o.id,req.uid)),user:profile(req.uid),actuallyRefunded:false};
  }));
  app.get('/api/admin/shop-orders',{preHandler:admin},async()=>({items:db.prepare('SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 100').all().map(order)}));
}
