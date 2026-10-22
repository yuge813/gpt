import { randomUUID, createHash } from 'node:crypto';
import { pointsRules } from './operations.mjs';
const error=(code,message)=>Object.assign(new Error(message),{statusCode:code});
const schema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const uuid={type:'string',format:'uuid'};
const key={type:'string',minLength:16,maxLength:128,pattern:'^[a-zA-Z0-9_-]+$'};
const line={type:'object',additionalProperties:false,properties:{productId:{type:'string',minLength:1,maxLength:64},quantity:{type:'integer',minimum:1,maximum:20}},required:['productId','quantity']};
export function registerCommerce({app,db,now,auth,admin,tx,ledger,allowReward,profile}){
  const items=id=>db.prepare('SELECT product_id,name,price,quantity,art FROM shop_items WHERE order_id=?').all(id);
  const owned=(id,uid)=>{const o=db.prepare('SELECT * FROM shop_orders WHERE id=? AND user_id=?').get(id,uid);if(!o)throw error(404,'订单不存在');return o;};
  const shipment=id=>db.prepare('SELECT carrier,tracking,created_at FROM shipments WHERE order_id=?').get(id)||null;
  const afterSale=id=>db.prepare('SELECT id,status,reason,resolution,created_at,resolved_at FROM after_sales WHERE order_id=?').get(id)||null;
  const order=o=>({...o,items:items(o.id),address:JSON.parse(o.address_json),shipment:shipment(o.id),afterSale:afterSale(o.id),address_json:undefined,fingerprint:undefined,request_key:undefined});
  const audit=(action,detail)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(),action,JSON.stringify(detail),now());
  const pendingAfterSale=id=>afterSale(id)?.status==='pending';
  const settings={preHandler:auth};
  app.get('/api/cart',settings,async req=>({items:db.prepare('SELECT p.*,c.quantity FROM cart c JOIN products p ON p.id=c.product_id WHERE c.user_id=?').all(req.uid)}));
  app.post('/api/cart',{...settings,schema:{body:schema(line.properties)}},async req=>{
    const p=db.prepare('SELECT * FROM products WHERE id=? AND price>0 AND enabled=1').get(req.body.productId);
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
        const p=db.prepare('SELECT * FROM products WHERE id=? AND price>0 AND enabled=1').get(input.productId);
        if(!p)throw error(404,'商品不存在或仅支持积分兑换');
        if(!db.prepare('UPDATE products SET stock=stock-?,version=version+1 WHERE id=? AND stock>=?').run(input.quantity,p.id,input.quantity).changes)throw error(409,`${p.name} 库存不足`);
        amount+=p.price*input.quantity;snapshots.push({...p,quantity:input.quantity});
      }
      if(req.body.couponId){
        const c=db.prepare('SELECT * FROM user_coupons WHERE id=? AND user_id=? AND used_order IS NULL AND expires_at>?').get(req.body.couponId,req.uid,now());
        if(!c)throw error(409,'优惠券无效或已使用');
        if(amount<c.threshold)throw error(409,`订单需满 ${c.threshold/100} 元才可使用该券`);
        amount=Math.max(0,amount-c.discount);
        db.prepare('UPDATE user_coupons SET used_order=? WHERE id=?').run(id,c.id);
      }
      db.prepare('INSERT INTO shop_orders VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,req.uid,'YJ'+now().toString()+randomUUID().slice(0,6).toUpperCase(),amount,Math.floor(amount*pointsRules(db).purchasePointsPerYuan/100),'pending',req.body.requestKey,fingerprint,JSON.stringify(address),req.body.couponId||null,now());
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
    if(pendingAfterSale(o.id))throw error(409,'订单售后审核中，暂不能发货');
    if(o.status==='paid')db.prepare("UPDATE shop_orders SET status='shipped' WHERE id=?").run(o.id);
    else if(!['shipped','completed'].includes(o.status))throw error(409,'请先完成测试付款');
    return {order:order(owned(o.id,req.uid)),shippingProvider:'demo',actuallyShipped:false};
  }));
  app.post('/api/shop/orders/:id/receive',{...settings,schema:actionSchema},async req=>{
    allowReward(req.uid,'purchase_reward');return tx(()=>{
      const o=owned(req.params.id,req.uid);
      if(pendingAfterSale(o.id))throw error(409,'订单售后审核中，暂不能确认收货');
      if(o.status!=='completed'){
        if(o.status!=='shipped')throw error(409,'订单尚未发货，不能确认收货');
        if(o.reward)ledger(req.uid,o.reward,'purchase','购物返积分 · '+o.number,'purchase:'+o.id);
        db.prepare("UPDATE shop_orders SET status='completed' WHERE id=?").run(o.id);
      }return {order:order(owned(o.id,req.uid)),user:profile(req.uid)};
    });
  });
  function restore(o){
    for(const p of items(o.id))db.prepare('UPDATE products SET stock=stock+?,version=version+1 WHERE id=?').run(p.quantity,p.product_id);
    if(o.coupon_id)db.prepare('UPDATE user_coupons SET used_order=NULL WHERE id=? AND used_order=?').run(o.coupon_id,o.id);
  }
  app.post('/api/shop/orders/:id/cancel',{...settings,schema:actionSchema},async req=>tx(()=>{
    const o=owned(req.params.id,req.uid);
    if(o.status==='pending'){restore(o);db.prepare("UPDATE shop_orders SET status='cancelled' WHERE id=?").run(o.id);}
    else if(o.status!=='cancelled')throw error(409,'已付款订单请走售后退款');
    return {order:order(owned(o.id,req.uid))};
  }));
  function refund(o){
    if(o.status==='refunded')return;
    if(!['paid','shipped','completed'].includes(o.status))throw error(409,'当前订单不可退款');
    if(o.status==='completed'&&o.reward){
      if(profile(o.user_id).points<o.reward)throw error(409,'已使用返还积分，需补足积分后重试或另行人工处理；本次未变更订单和售后状态');
      ledger(o.user_id,-o.reward,'purchase_refund','退款回收购物积分 · '+o.number,'refund:'+o.id);
    }
    restore(o);db.prepare("UPDATE shop_orders SET status='refunded' WHERE id=?").run(o.id);
  }
  app.post('/api/shop/orders/:id/refund',{...settings,schema:actionSchema},async req=>tx(()=>{
    const o=owned(req.params.id,req.uid);
    if(pendingAfterSale(o.id))throw error(409,'该订单已有待审核售后，请等待商家处理');
    refund(o);
    return {order:order(owned(o.id,req.uid)),user:profile(req.uid),actuallyRefunded:false};
  }));
  app.post('/api/admin/shop-orders/:id/ship',{
    preHandler:admin,schema:{params:schema({id:uuid}),body:schema({carrier:{type:'string',minLength:2,maxLength:40},tracking:{type:'string',minLength:5,maxLength:64,pattern:'^[A-Za-z0-9][A-Za-z0-9 -]*$'}})}
  },async req=>tx(()=>{
    if(req.body.carrier.trim().length<2||req.body.tracking.trim().length<5)throw error(400,'请填写有效的物流公司和至少 5 位物流单号');
    const o=db.prepare('SELECT * FROM shop_orders WHERE id=?').get(req.params.id);
    if(!o)throw error(404,'订单不存在');
    const existing=shipment(o.id);
    const carrier=req.body.carrier.trim(),tracking=req.body.tracking.trim();
    if(existing){
      if(existing.carrier!==carrier||existing.tracking!==tracking)throw error(409,'订单已登记不同物流信息，不能重复发货');
      return {order:order(o),replayed:true,actuallyShipped:false};
    }
    if(pendingAfterSale(o.id))throw error(409,'订单售后审核中，暂不能发货');
    if(o.status!=='paid')throw error(409,'仅待发货订单可以登记发货');
    db.prepare('INSERT INTO shipments VALUES(?,?,?,?)').run(o.id,carrier,tracking,now());
    db.prepare("UPDATE shop_orders SET status='shipped' WHERE id=?").run(o.id);
    audit('order.ship',{orderId:o.id,carrier,tracking});
    return {order:order(db.prepare('SELECT * FROM shop_orders WHERE id=?').get(o.id)),actuallyShipped:false};
  }));
  app.post('/api/shop/orders/:id/after-sales',{
    ...settings,schema:{params:schema({id:uuid}),body:schema({reason:{type:'string',minLength:5,maxLength:500}})}
  },async(req,reply)=>{
    const reason=req.body.reason.trim();
    if(reason.length<5)throw error(400,'请填写至少 5 个字符的售后原因');
    const result=tx(()=>{
      const o=owned(req.params.id,req.uid);
      const existing=afterSale(o.id);
      if(existing)return {request:existing,afterSale:existing,order:order(o),replayed:true};
      if(!['paid','shipped','completed'].includes(o.status))throw error(409,'当前订单不可申请售后');
      const id=randomUUID();
      db.prepare('INSERT INTO after_sales(id,order_id,user_id,status,reason,created_at) VALUES(?,?,?,?,?,?)').run(id,o.id,req.uid,'pending',reason,now());
      audit('after_sale.request',{id,orderId:o.id,userId:req.uid});
      const request=afterSale(o.id);return {request,afterSale:request,order:order(o),replayed:false};
    });
    reply.code(result.replayed?200:201);return result;
  });
  app.get('/api/admin/after-sales',{preHandler:admin},async()=>({items:db.prepare(`SELECT a.id,a.order_id AS orderId,o.number AS orderNumber,a.user_id AS userId,o.amount,o.reward,a.status,a.reason,a.resolution,a.created_at,a.resolved_at
    FROM after_sales a JOIN shop_orders o ON o.id=a.order_id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100`).all().map(a=>({...a,items:items(a.orderId)}))}));
  app.post('/api/admin/after-sales/:id/resolve',{
    preHandler:admin,schema:{params:schema({id:uuid}),body:schema({decision:{type:'string',enum:['approve','reject']},note:{type:'string',minLength:3,maxLength:500}})}
  },async req=>tx(()=>{
    const note=req.body.note.trim();if(note.length<3)throw error(400,'请填写至少 3 个字符的处理说明');
    const request=db.prepare('SELECT * FROM after_sales WHERE id=?').get(req.params.id);
    if(!request)throw error(404,'售后申请不存在');
    const wanted=req.body.decision==='approve'?'approved':'rejected';
    if(request.status!=='pending'){
      if(request.status!==wanted||request.resolution!==note)throw error(409,'售后已处理，不能变更处理结果');
      return {afterSale:afterSale(request.order_id),order:order(owned(request.order_id,request.user_id)),replayed:true,actuallyRefunded:false};
    }
    const o=owned(request.order_id,request.user_id);
    if(wanted==='approved')refund(o);
    db.prepare('UPDATE after_sales SET status=?,resolution=?,resolved_at=? WHERE id=?').run(wanted,note,now(),request.id);
    audit('after_sale.resolve',{id:request.id,orderId:request.order_id,decision:req.body.decision,note});
    return {afterSale:afterSale(request.order_id),order:order(owned(request.order_id,request.user_id)),actuallyRefunded:false};
  }));
  app.get('/api/admin/shop-orders',{preHandler:admin},async()=>({items:db.prepare('SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 100').all().map(order)}));
}
