import { randomUUID } from 'node:crypto';

const schema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const fail=(status,message)=>Object.assign(new Error(message),{statusCode:status});
export function pointsRules(db){
  return {purchasePointsPerYuan:Number(db.prepare('SELECT value FROM settings WHERE key=?').get('purchase_points_per_yuan').value)};
}
export function publicProduct(product,db){
  return {...product,enabled:Boolean(product.enabled),rewardPoints:Math.floor(product.price*pointsRules(db).purchasePointsPerYuan/100)};
}

export function registerOperations({app,db,admin,tx,now}){
  const audit=(action,detail)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(),action,JSON.stringify(detail),now());
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
