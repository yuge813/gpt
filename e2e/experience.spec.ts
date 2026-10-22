import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const adminHeaders={'X-Admin-Token':'e2e-only-admin-credential-not-for-production'}
async function adminPost(api:APIRequestContext,path:string,data:unknown){
 const response=await api.post('/api'+path,{headers:adminHeaders,data})
 expect(response.status(),`merchant API ${path}`).toBeLessThan(300)
 return response.json()
}
async function login(page:Page){
 await page.locator('.m-mobile-nav:visible,.m-desktop-nav:visible').getByText(/^(我的商城|我的)$/).click()
 await page.getByRole('button',{name:'登录 / 注册'}).click()
 await page.locator('.m-consent').click()
 await page.getByRole('button',{name:'同意并登录体验'}).click()
 await expect(page.locator('.m-modal-mask')).toHaveCount(0)
}
async function go(page:Page,label:string){await page.locator('.m-desktop-nav:visible,.m-mobile-nav:visible').getByText(label,{exact:true}).click()}
async function addHeadphones(page:Page){await page.locator('.m-brand').click();await page.getByRole('button',{name:/加入购物车 声屿/}).click();await expect(page.locator('.m-toast')).toContainText('已加入购物车')}
async function addAddress(page:Page){
 await page.getByRole('button',{name:'提交订单'}).click()
 await page.getByRole('button',{name:'新增测试地址'}).click()
 await page.locator('.m-form input').nth(0).fill('测试用户')
 await page.locator('.m-form input').nth(1).fill('13800000000')
 await page.locator('.m-form textarea').fill('测试省测试市演示路 1 号')
 await page.getByRole('button',{name:'保存地址'}).click()
 await page.locator('.m-address-option').first().click()
}
async function placeOrder(page:Page){
 const response=page.waitForResponse(r=>r.url().endsWith('/api/shop/checkout')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'提交订单'}).click()
 const r=await response;expect(r.status()).toBe(201)
 return (await r.json()).order
}
async function merchantLogin(page:Page){
 await page.goto('/');await page.locator('.m-footer').getByText('商家后台',{exact:true}).click()
 await page.locator('.admin-input input').fill(adminHeaders['X-Admin-Token'])
 await page.getByRole('button',{name:'安全进入'}).click()
 await expect(page.getByTestId('ops-nav-products')).toBeVisible()
}
async function merchantShip(page:Page,order:any,usingUi=false){
 const tracking='TEST'+order.number
 if(usingUi){
  const merchant=await page.context().newPage()
  try{
   await merchantLogin(merchant);await merchant.getByTestId('ops-nav-orders').click()
   await merchant.locator(`.ops-order[data-order-id="${order.id}"]`).getByRole('button',{name:'录入发货'}).click()
   await merchant.getByTestId('ops-shipping-carrier').locator('input').fill('测试物流')
   await merchant.getByTestId('ops-shipping-tracking').locator('input').fill(tracking)
   const response=merchant.waitForResponse(r=>r.url().endsWith(`/admin/shop-orders/${order.id}/ship`)&&r.request().method()==='POST')
   await merchant.getByTestId('ops-shipping-save').click();expect((await response).status()).toBe(200)
  }finally{await merchant.close()}
 }else await adminPost(page.request,`/admin/shop-orders/${order.id}/ship`,{carrier:'测试物流',tracking})
 await page.getByRole('button',{name:'刷新订单'}).click()
 await page.locator('.m-order-tabs').getByText('全部',{exact:true}).click()
 await expect(page.locator('.m-shipment-card')).toContainText(tracking)
 await expect(page.getByRole('button',{name:'模拟发货',exact:true})).toHaveCount(0)
}

test('shopping receipt earns points, coupon lowers next checkout and merchant controls shipment',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/');await expect(page.getByText('每一笔购物')).toBeVisible()
 await expect(page.locator('.m-product')).toHaveCount(6)
 await expect.poll(()=>page.locator('.m-product-photo img,.m-hero-art img').evaluateAll(imgs=>imgs.length===7&&imgs.every(i=>(i as HTMLImageElement).complete&&(i as HTMLImageElement).naturalWidth>0))).toBeTruthy()
 await page.screenshot({path:`docs/screenshots/${info.project.name}-home.png`,fullPage:true})
 await login(page);await expect(page.locator('.m-account-stats').getByText('0',{exact:true}).first()).toBeVisible()
 await addHeadphones(page);await page.locator('.m-header-cart').click()
 await page.getByRole('button',{name:'增加数量'}).click();await expect(page.locator('.m-stepper')).toContainText('2')
 await page.getByRole('button',{name:'去结算'}).click();await addAddress(page)
 await page.screenshot({path:`docs/screenshots/${info.project.name}-checkout.png`,fullPage:true})
 const order=await placeOrder(page)
 await expect(page.locator('.m-pay-amount')).toContainText('598.00')
 await page.getByRole('button',{name:'确认测试付款（不扣款）'}).click()
 await expect(page.getByRole('button',{name:'模拟发货',exact:true})).toHaveCount(0)
 await merchantShip(page,order,true)
 await page.getByRole('button',{name:'确认收货，领积分'}).click()
 await expect(page.locator('.m-order-total')).toContainText('已返 598 积分')
 const orderSearch=page.locator('.m-order-search input')
 await orderSearch.fill('不存在的商品订单');await expect(page.locator('.m-order-card')).toHaveCount(0)
 await orderSearch.fill(order.number);await expect(page.locator('.m-order-card')).toHaveCount(1)
 await page.getByRole('button',{name:'清空订单搜索',exact:true}).click();await expect(orderSearch).toHaveValue('')
 await page.screenshot({path:`docs/screenshots/${info.project.name}-orders.png`,fullPage:true})
 await go(page,info.project.name==='mobile'?'积分':'积分商城')
 await expect(page.locator('.m-points-balance')).toContainText('598')
 await page.locator('.m-product').filter({hasText:'20 元购物券'}).click();await page.getByRole('button',{name:'确认积分兑换'}).click()
 await expect(page.locator('.m-points-balance')).toContainText('298')
 await addHeadphones(page);await page.locator('.m-header-cart').click();await page.getByRole('button',{name:'去结算'}).click()
 await page.locator('.m-coupon-option').filter({hasText:'减 ¥20.00'}).click()
 await expect(page.locator('.m-summary-total')).toContainText('279.00');await expect(page.locator('.m-summary-reward')).toContainText('279 积分')
 await placeOrder(page);await expect(page.locator('.m-pay-amount')).toContainText('279.00')
 await page.locator('.m-modal-close').click();await page.getByRole('button',{name:'取消订单'}).click()
 await expect(page.locator('.m-order-card').filter({hasText:'已取消'})).toHaveCount(1)
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
})

test('customer after-sale waits for merchant approval and approval reverses awarded points once',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/');await login(page)
 await page.locator('.m-brand').click();await page.getByRole('button',{name:/加入购物车 山野/}).click()
 await expect(page.locator('.m-toast')).toContainText('已加入购物车');await page.locator('.m-header-cart').click()
 await page.getByRole('button',{name:'去结算'}).click();await addAddress(page)
 const order=await placeOrder(page)
 await page.getByRole('button',{name:'确认测试付款（不扣款）'}).click();await merchantShip(page,order)
 await page.getByRole('button',{name:'确认收货，领积分'}).click();await expect(page.locator('.m-order-total')).toContainText('已返 99 积分')
 await page.getByRole('button',{name:'申请售后',exact:true}).click()
 await page.locator('.m-after-sale-form textarea').fill('测试商品售后原因，仅测试账务，不真实退货')
 await page.getByRole('button',{name:'提交售后申请'}).click()
 await expect(page.locator('.m-after-sale')).toContainText('审核中')
 const response=await page.request.get('/api/admin/after-sales',{headers:adminHeaders});expect(response.status()).toBe(200)
 const application=(await response.json()).items.find((a:any)=>a.orderId===order.id)
 expect(application).toBeTruthy();expect(application.status).toBe('pending')
 const merchant=await page.context().newPage()
 try{
  await merchantLogin(merchant);await merchant.getByTestId('ops-nav-afterSales').click()
  await merchant.locator(`.ops-review-card[data-review-id="${application.id}"]`).getByTestId('ops-review-approve').click()
  await merchant.getByTestId('ops-review-note').locator('textarea').fill('测试审批通过，不涉及真实资金退款')
  const resolved=merchant.waitForResponse(r=>r.url().endsWith(`/admin/after-sales/${application.id}/resolve`)&&r.request().method()==='POST')
  await merchant.getByTestId('ops-review-submit').click();expect((await resolved).status()).toBe(200)
 }finally{await merchant.close()}
 await page.getByRole('button',{name:'刷新订单'}).click();await expect(page.locator('.m-after-sale')).toContainText('已批准')
 await expect(page.locator('.m-after-sale-resolution')).toContainText('测试审批通过')
 await expect(page.locator('.m-order-card')).toContainText('已退款')
 await page.screenshot({path:`docs/screenshots/${info.project.name}-after-sales.png`,fullPage:true})
 await go(page,info.project.name==='mobile'?'我的':'我的商城');await page.locator('.m-account-stats>uni-view').first().click()
 await expect(page.locator('.m-wallet-number')).toHaveText('0')
 await expect(page.locator('.m-ledger-row')).toHaveCount(2)
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
})

test('task rewards remain supplementary and search, details, favorites and privacy work',async({page},info)=>{
 await page.goto('/');await expect(page.locator('.m-product')).toHaveCount(6)
 await page.locator('.m-search input').fill('不存在的商品');await page.getByRole('button',{name:'搜索',exact:true}).click()
 await expect(page.getByText('没有找到匹配的商品')).toBeVisible();await page.getByRole('button',{name:'查看全部商品'}).click()
 await page.locator('.m-product').first().click();await expect(page.getByRole('button',{name:'立即购买'})).toBeVisible()
 await page.getByRole('button',{name:'收藏',exact:false}).click();await expect(page.getByRole('button',{name:/已收藏/})).toBeVisible()
 await page.locator('.m-modal-close').click();await login(page)
 await page.getByText('签到与广告激励',{exact:false}).click();await page.getByRole('button',{name:'签到领取积分'}).click()
 await expect(page.getByRole('button',{name:'今日已签到'})).toBeDisabled()
 await page.getByRole('button',{name:'去体验'}).click();await expect(page.getByRole('button',{name:'领取 30 演示积分'})).toBeEnabled({timeout:15000})
 await page.getByRole('button',{name:'领取 30 演示积分'}).click();await expect(page.locator('.m-modal-mask')).toHaveCount(0)
 await go(page,info.project.name==='mobile'?'我的':'我的商城');await page.locator('.m-account-stats>uni-view').first().click()
 await expect(page.locator('.m-wallet-number')).toHaveText('50');await expect(page.locator('.m-ledger-row')).toHaveCount(2)
 await page.locator('.m-footer').getByText('隐私说明',{exact:true}).click();await expect(page.locator('.m-modal-title')).toHaveText('隐私与体验说明')
})

test('merchant changes are authenticated, reflected in catalog and protected against stale edits',async({page},info)=>{
 expect((await page.request.get('/api/admin/products')).status()).toBe(403)
 expect((await page.request.post('/api/admin/points-rules',{data:{purchasePointsPerYuan:10}})).status()).toBe(403)
 const initialCatalog=(await (await page.request.get('/api/catalog')).json()).products
 const value={id:'',version:0,name:'自动验收专用商品',subtitle:'测试用，不实际出售',category:'生活美学',price:12300,points:200,stock:4,art:'cup',badge:'测试商品',enabled:true}
 let created:any
 try{
  const result=await adminPost(page.request,'/admin/products/save',value);created=result.product
  expect(created.id).toBeTruthy()
  const catalog=(await (await page.request.get('/api/catalog')).json()).products
  expect(catalog.find((p:any)=>p.id===created.id)?.price).toBe(12300)
  const update={...value,id:created.id,version:created.version,name:'自动验收更新商品',stock:7}
  const updated=(await adminPost(page.request,'/admin/products/save',update)).product
  expect(updated.version).toBeGreaterThan(created.version)
  expect((await page.request.post('/api/admin/products/save',{headers:adminHeaders,data:update})).status()).toBe(409)
  created=updated
  await adminPost(page.request,'/admin/products/save',{...update,version:updated.version,enabled:false})
  expect((await (await page.request.get('/api/catalog')).json()).products.some((p:any)=>p.id===created.id)).toBeFalsy()
  await adminPost(page.request,'/admin/points-rules',{purchasePointsPerYuan:2})
  const changed=(await (await page.request.get('/api/catalog')).json()).products.find((p:any)=>p.id==='cup')
  expect(changed.rewardPoints).toBe(Math.floor(changed.price*2/100))
 }finally{
  await adminPost(page.request,'/admin/points-rules',{purchasePointsPerYuan:1})
  if(created){
   const products=(await (await page.request.get('/api/admin/products',{headers:adminHeaders})).json()).items
   const current=products.find((p:any)=>p.id===created.id)
   if(current?.enabled)await adminPost(page.request,'/admin/products/save',{...value,id:current.id,version:current.version,enabled:false})
  }
 }
 expect((await (await page.request.get('/api/catalog')).json()).products.length).toBe(initialCatalog.length)
 await merchantLogin(page)
 await expect(page.locator('.ops-nav').getByText('商品管理',{exact:true})).toBeVisible()
 await page.getByTestId('ops-nav-products').click()
 await page.getByRole('button',{name:'新建商品',exact:false}).click()
 await page.getByTestId('ops-product-name').locator('input').fill('界面验收创建商品')
 await page.getByTestId('ops-product-subtitle').locator('input').fill('验证商品表单和库存保存')
 await page.getByTestId('ops-product-price').locator('input').fill('88.50')
 await page.getByTestId('ops-product-points').locator('input').fill('150')
 await page.getByTestId('ops-product-stock').locator('input').fill('3')
 const productSaved=page.waitForResponse(r=>r.url().endsWith('/admin/products/save')&&r.request().method()==='POST')
 await page.getByTestId('ops-product-save').click()
 const saved=await productSaved;expect(saved.status()).toBe(201)
 const uiProduct=(await saved.json()).product
 try{
  await expect(page.locator('.ops-modal-mask')).toHaveCount(0)
  const card=page.locator(`.ops-product-card[data-product-id="${uiProduct.id}"]`)
  await expect(card).toContainText('88.50')
  await card.getByRole('button',{name:'编辑商品'}).click()
  await page.getByTestId('ops-product-stock').locator('input').fill('5')
  await page.getByRole('button',{name:'已上架 · 点击下架'}).click()
  const edited=page.waitForResponse(r=>r.url().endsWith('/admin/products/save')&&r.request().method()==='POST')
  await page.getByTestId('ops-product-save').click();expect((await edited).status()).toBe(200)
  await expect(page.locator('.ops-modal-mask')).toHaveCount(0)
  expect((await (await page.request.get('/api/catalog')).json()).products.some((p:any)=>p.id===uiProduct.id)).toBeFalsy()
  await page.screenshot({path:`docs/screenshots/${info.project.name}-products-admin.png`,fullPage:true})
 }finally{
  const list=(await (await page.request.get('/api/admin/products',{headers:adminHeaders})).json()).items
  const current=list.find((p:any)=>p.id===uiProduct.id)
  if(current?.enabled)await adminPost(page.request,'/admin/products/save',{...value,id:current.id,version:current.version,enabled:false})
 }
 await page.getByTestId('ops-nav-rules').click()
 try{
  await page.getByTestId('ops-reward-rate').locator('input').fill('0')
  const savedRule=page.waitForResponse(r=>r.url().endsWith('/admin/points-rules')&&r.request().method()==='POST')
  await page.getByTestId('ops-reward-save').click();expect((await savedRule).status()).toBe(200)
  expect((await (await page.request.get('/api/points-rules')).json()).purchasePointsPerYuan).toBe(0)
 }finally{await adminPost(page.request,'/admin/points-rules',{purchasePointsPerYuan:1})}
 await page.getByTestId('ops-nav-orders').click()
 const downloadEvent=page.waitForEvent('download')
 await page.getByTestId('ops-orders-export').click()
 const csvDownload=await downloadEvent
 expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/)
 expect(await csvDownload.failure()).toBeNull()
 await page.getByTestId('ops-nav-ads').click()
 await page.getByRole('button',{name:'开启预览'}).first().click();await expect(page.getByRole('button',{name:'关闭预览'})).toHaveCount(1)
 await page.getByRole('button',{name:'关闭预览'}).click();await expect(page.getByRole('button',{name:'关闭预览'})).toHaveCount(0)
 await page.screenshot({path:`docs/screenshots/${info.project.name}-admin.png`,fullPage:true})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
})
