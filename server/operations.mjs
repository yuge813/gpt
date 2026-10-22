import { randomUUID } from 'node:crypto';

const schema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const fail=(status,message)=>Object.assign(new Error(message),{statusCode:status});
// Quoting alone does not stop spreadsheet formulas. Prefix dangerous cells before
// RFC 4180 escaping, including formulas hidden behind whitespace/control characters.
const csvCell=value=>{
  let text=String(value??'');
  if(/^[\s\u0000-\u001f]*[=+@-]/u.test(text)||/^[\u0000-\u001f]/u.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
export function pointsRules(db){
  return {purchasePointsPerYuan:Number(db.prepare('SELECT value FROM settings WHERE key=?').get('purchase_points_per_yuan').value)};
}
export function publicProduct(product,db){
  return {...product,enabled:Boolean(product.enabled),rewardPoints:Math.floor(product.price*pointsRules(db).purchasePointsPerYuan/100)};
}

export function registerOperations({app,db,admin,tx,now}){
  const audit=(action,detail)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(),action,JSON.stringify(detail),now());
  app.get('/api/admin/shop-orders/export.csv',{
    preHandler:admin,
    schema:{querystring:{type:'object',additionalProperties:false,properties:{
      limit:{type:'string',pattern:'^(?:[1-9][0-9]{0,2}|1000)$'},
      status:{type:'string',enum:['pending','paid','shipped','completed','cancelled','refunded']}
    }}}
  },async(req,reply)=>{
    const {status}=req.query,limit=Number(req.query.limit||100);
    const orders=db.prepare(`SELECT o.number,o.status,o.amount,o.reward,o.created_at,o.id,s.carrier,s.tracking
      FROM shop_orders o LEFT JOIN shipments s ON s.order_id=o.id
      ${status?'WHERE o.status=?':''} ORDER BY o.created_at DESC,o.id DESC LIMIT ?`).all(...(status?[status,limit]:[limit]));
    const itemQuery=db.prepare('SELECT name,quantity FROM shop_items WHERE order_id=? ORDER BY product_id');
    const rows=[['订单号','状态','实付金额（元，测试账务）','返积分','商品摘要','承运商（手工登记）','运单号','创建时间（UTC）'],
      ...orders.map(o=>[o.number,o.status,(o.amount/100).toFixed(2),o.reward,
        itemQuery.all(o.id).map(i=>`${i.name} × ${i.quantity}`).join('; '),o.carrier,o.tracking,new Date(o.created_at).toISOString()])];
    audit('order.export',{count:orders.length,limit,status:status||'all'});
    // Deliberately exclude addresses, phone numbers, user IDs and internal tokens.
    return reply.header('Content-Type','text/csv; charset=utf-8')
      .header('Content-Disposition','attachment; filename="aurora-test-orders.csv"')
      .header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff')
      .send('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
  });
  app.get('/api/points-rules',async()=>pointsRules(db));
  app.get('/api/admin/points-rules',{preHandler:admin},async()=>pointsRules(db));
  app.post('/api/admin/points-rules',{
    preHandler:admin,schema:{body:schema({purchasePointsPerYuan:{type:'integer',minimum:0,maximum:10}})}
  },async req=>tx(()=>{
    db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(req.body.purchasePointsPerYuan),'purchase_points_per_yuan');
    audit('points.rules.update',req.body);
    return pointsRules(db);
  }));
  app.get('/api/admin/products',{preHandler:admin},async()=>({items:db.prepare('SELECT * FROM products ORDER BY rowid').all().map(p=>publicProduct(p,db))}));
  app.post('/api/admin/products/save',{
    preHandler:admin,schema:{body:schema({
      id:{type:'string',maxLength:64,pattern:'^[A-Za-z0-9_-]*$'},version:{type:'integer',minimum:0},
      name:{type:'string',minLength:2,maxLength:80},subtitle:{type:'string',minLength:2,maxLength:160},
      category:{type:'string',enum:['数码好物','生活美学','出行装备','专属权益']},
      price:{type:'integer',minimum:0,maximum:10000000},points:{type:'integer',minimum:1,maximum:1000000},
      stock:{type:'integer',minimum:0,maximum:1000000},art:{type:'string',enum:['headphones','lamp','speaker','cup','bag','mouse','coupon']},
      badge:{type:'string',maxLength:20},enabled:{type:'boolean'}
    })}
  },async(req,reply)=>{
    const input=req.body;
    if(input.name.trim().length<2||input.subtitle.trim().length<2)throw fail(400,'商品名称和描述去除空白后至少需要 2 个字符');
    // The existing coupon redemption path has one documented coupon definition.
    // Other products cannot pretend to issue an arbitrary coupon merely by using its artwork.
    if(input.id==='coupon'&&(input.price!==0||input.art!=='coupon'||input.category!=='专属权益'))throw fail(400,'购物券商品需保留积分权益类型、券图和零现金价格');
    if(input.id&&input.version===0)throw fail(400,'编辑商品必须提交当前版本号');
    if(!input.id&&input.version!==0)throw fail(400,'新增商品版本号必须为 0');
    const product=tx(()=>{
      const id=input.id||randomUUID();
      if(input.id){
        const existing=db.prepare('SELECT * FROM products WHERE id=?').get(id);
        if(!existing)throw fail(404,'商品不存在');
        const changed=db.prepare('UPDATE products SET name=?,subtitle=?,category=?,price=?,points=?,stock=?,art=?,badge=?,enabled=?,version=version+1 WHERE id=? AND version=?').run(
          input.name.trim(),input.subtitle.trim(),input.category,input.price,input.points,input.stock,input.art,input.badge.trim(),Number(input.enabled),id,input.version
        );
        if(!changed.changes)throw fail(409,'商品或库存已变更，请刷新后重新编辑');
      }else{
        db.prepare('INSERT INTO products(id,name,subtitle,category,price,points,stock,art,color,badge,enabled,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)').run(
          id,input.name.trim(),input.subtitle.trim(),input.category,input.price,input.points,input.stock,input.art,'#d9dfe6',input.badge.trim(),Number(input.enabled)
        );
      }
      audit(input.id?'product.update':'product.create',{id,version:input.version,stock:input.stock,enabled:input.enabled});
      return publicProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id),db);
    });
    reply.code(input.id?200:201);return {product};
  });
}
