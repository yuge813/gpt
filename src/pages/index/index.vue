<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { request, idempotencyKey } from '../../lib/api'
import { money, photo, orderStatus, afterSaleStatus, type ShopProduct } from '../../lib/shop'
import ShopProductCard from '../../components/ShopProduct.vue'
import AdPlacement from '../../components/AdPlacement.vue'

const nav=[{id:'home',label:'商城首页',short:'首页',icon:'⌂'},{id:'category',label:'商品分类',short:'分类',icon:'▦'},{id:'points',label:'积分商城',short:'积分',icon:'◇'},{id:'cart',label:'购物车',short:'购物车',icon:'▱'},{id:'mine',label:'我的商城',short:'我的',icon:'♙'}]
const active=ref('home'),catalog=ref<ShopProduct[]>([]),user=ref<any>(null),cart=ref<any[]>([]),addresses=ref<any[]>([]),orders=ref<any[]>([]),coupons=ref<any[]>([]),ledger=ref<any[]>([]),redemptions=ref<any[]>([])
const loading=ref(true),error=ref(''),busy=ref(false),message=ref(''),query=ref(''),category=ref('全部'),sort=ref('综合'),modal=ref(''),consent=ref(false),selected=ref<ShopProduct|null>(null)
const checkoutItems=ref<any[]>([]),addressId=ref(''),couponId=ref(''),checkoutKey=ref(''),payOrder=ref<any>(null),orderFilter=ref('全部'),orderQuery=ref(''),infoTitle=ref(''),infoBody=ref('')
const recipient=ref(''),phone=ref(''),detail=ref(''),adsEnabled=ref(true),placements=ref<any[]>([]),ad=ref<any>(null),seconds=ref(0),purchaseRate=ref(1),afterSaleReason=ref(''),accountSyncError=ref(''),infoReturnModal=ref('')
const authMode=ref<'demo'|'login'|'register'>('demo'),username=ref(''),password=ref(''),passwordConfirm=ref(''),authError=ref(''),currentPassword=ref(''),newPassword=ref(''),newPasswordConfirm=ref('')
const favorites=ref<string[]>(uni.getStorageSync('aurora-favorites')||[])
let noticeTimer:ReturnType<typeof setTimeout>|undefined,adTimer:ReturnType<typeof setInterval>|undefined,afterLogin:(()=>void|Promise<void>)|null=null,refreshVersion=0
const categories=['全部','数码好物','生活美学','出行装备']
const shopProducts=computed(()=>catalog.value.filter(p=>p.price>0&&p.enabled!==false&&p.enabled!==0))
const shown=computed(()=>{
 let list=(active.value==='points'?catalog.value:shopProducts.value).filter(p=>p.enabled!==false&&p.enabled!==0&&(category.value==='全部'||p.category===category.value)&&(!query.value||p.name.includes(query.value)||p.category.includes(query.value)))
 if(sort.value==='价格升序')list=[...list].sort((a,b)=>a.price-b.price)
 if(sort.value==='返积分优先')list=[...list].sort((a,b)=>b.rewardPoints-a.rewardPoints)
 if(sort.value==='低积分优先')list=[...list].sort((a,b)=>a.points-b.points)
 return list
})
const cartCount=computed(()=>cart.value.reduce((n,p)=>n+p.quantity,0))
const cartTotal=computed(()=>cart.value.reduce((n,p)=>n+p.price*p.quantity,0))
const subtotal=computed(()=>checkoutItems.value.reduce((n,p)=>n+p.price*p.quantity,0))
const discount=computed(()=>coupons.value.find(c=>c.id===couponId.value)?.discount||0)
const payable=computed(()=>Math.max(0,subtotal.value-discount.value))
const selectedAddress=computed(()=>addresses.value.find(a=>a.id===addressId.value))
const availableCoupons=computed(()=>coupons.value.filter(c=>c.status==='available'&&subtotal.value>=c.threshold))
const normalizedOrderQuery=computed(()=>orderQuery.value.trim().toLocaleLowerCase())
const visibleOrders=computed(()=>orders.value.filter(o=>{
 const matchesStatus=orderFilter.value==='全部'||(orderFilter.value==='售后中'?o.afterSale?.status==='pending':orderStatus[o.status]===orderFilter.value)
 const search=normalizedOrderQuery.value
 return matchesStatus&&(!search||String(o.number).toLocaleLowerCase().includes(search)||(o.items||[]).some((p:any)=>String(p.name).toLocaleLowerCase().includes(search)))
}))
const orderEmptyTitle=computed(()=>normalizedOrderQuery.value?'没有找到匹配的订单':orderFilter.value==='全部'?'还没有订单':`暂无${orderFilter.value}订单`)
function clearOrderFilters(){orderQuery.value='';orderFilter.value='全部'}
const pointBalance=computed(()=>Number(user.value?.points||0).toLocaleString())
const rateDescription=computed(()=>purchaseRate.value?`每满 1 元积 ${purchaseRate.value} 分`:'当前购物返积分已暂停')
const estimatedPoints=(amount:number)=>Math.floor(amount*purchaseRate.value/100)
const unavailable=(p:any)=>p.enabled===false||p.enabled===0||p.stock<1
function tell(s:string){message.value=s;if(noticeTimer)clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>message.value='',4500)}
async function act(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;try{await fn()}catch(e:any){tell(e.message)}finally{busy.value=false}}
function info(title:string,body:string){infoReturnModal.value=modal.value==='login'?'login':'';infoTitle.value=title;infoBody.value=body;modal.value='info'}
function go(id:string){active.value=id;query.value='';category.value='全部';sort.value='综合';uni.pageScrollTo({scrollTop:0,duration:120});if(id==='checkout'&&!checkoutItems.value.length)active.value='cart'}
function logged(resume?:()=>void|Promise<void>){if(user.value)return true;afterLogin=resume||null;modal.value='login';return false}
function resetAccount(){user.value=null;cart.value=[];orders.value=[];ledger.value=[];redemptions.value=[];addresses.value=[];coupons.value=[];addressId.value='';couponId.value='';accountSyncError.value='';orderQuery.value=''}
async function refresh(){
 const version=++refreshVersion,token=uni.getStorageSync('aurora-token')
 const [c,r]=await Promise.all([request('/catalog'),request('/points-rules')])
 if(version!==refreshVersion)return
 catalog.value=c.products;placements.value=c.placements||[];adsEnabled.value=c.adsEnabled;purchaseRate.value=r.purchasePointsPerYuan
 if(token){
  try{
   const me=await request('/me')
   if(version!==refreshVersion||uni.getStorageSync('aurora-token')!==token)return
   user.value=me
   const results=await Promise.allSettled([request('/cart'),request('/addresses'),request('/shop/orders'),request('/coupons'),request('/ledger'),request('/orders')])
   if(version!==refreshVersion||uni.getStorageSync('aurora-token')!==token)return
   const targets=[cart,addresses,orders,coupons,ledger,redemptions]
   results.forEach((result,i)=>{if(result.status==='fulfilled')targets[i].value=result.value.items})
   if(!addresses.value.some(a=>a.id===addressId.value))addressId.value=addresses.value[0]?.id||''
   if(couponId.value&&!coupons.value.some(c=>c.id===couponId.value&&c.status==='available'))couponId.value=''
   accountSyncError.value=results.some(r=>r.status==='rejected')?'部分账户数据未加载成功，请点击刷新重试。':''
  }catch(e:any){if(e.status===401){resetAccount()}else throw e}
 }else resetAccount()
}
async function syncSuccess(text:string){try{await refresh();tell(accountSyncError.value?`${text}；部分数据加载失败，请刷新核对。`:text)}catch{accountSyncError.value='数据刷新失败，请点击刷新核对最新状态。';tell(`${text}；请刷新核对最新状态，不要重复提交。`)}}
async function load(){loading.value=true;error.value='';try{await refresh()}catch(e:any){error.value=e.message}finally{loading.value=false}}
async function login(){
 if(!consent.value){tell('请先阅读并同意体验与隐私说明');return}
 let success=false
 await act(async()=>{const r=await request('/auth/demo','POST',{consent:true});uni.setStorageSync('aurora-token',r.token);user.value=r.user;modal.value='';success=true;await syncSuccess('登录成功，购物积分按订单规则入账')})
 if(success&&afterLogin){const resume=afterLogin;afterLogin=null;await resume()}
}
function clearCredentials(){password.value='';passwordConfirm.value='';currentPassword.value='';newPassword.value='';newPasswordConfirm.value=''}
function switchAuthMode(mode:'demo'|'login'|'register'){authMode.value=mode;clearCredentials();authError.value=''}
function validPassword(value:string){return value.length>=12&&value.length<=128}
async function accountLogin(){
 authError.value=''
 const name=username.value.trim()
 if(!/^[A-Za-z0-9_]{3,32}$/.test(name)){authError.value='账号需为 3–32 位英文字母、数字或下划线';return}
 if(!validPassword(password.value)){authError.value='密码需为 12–128 个字符';return}
 if(authMode.value==='register'&&password.value!==passwordConfirm.value){authError.value='两次输入的密码不一致';return}
 if(authMode.value==='register'&&!consent.value){authError.value='请先阅读并同意体验与隐私说明';return}
 let success=false
 await act(async()=>{
  try{
   const registering=authMode.value==='register'
   const data:Record<string,unknown>={username:name,password:password.value}
   if(registering)data.consent=true
   const r=await request(registering?'/auth/register':'/auth/login','POST',data)
   uni.setStorageSync('aurora-token',r.token);refreshVersion++;resetAccount();user.value=r.user;clearCredentials();modal.value='';success=true
   await syncSuccess(registering?'账号已创建，请妥善保管账号和密码':'账号登录成功')
  }catch(e:any){authError.value=e.message||'账号操作失败，请稍后重试'}
 })
 if(success&&afterLogin){const resume=afterLogin;afterLogin=null;await resume()}
}
function showRedemptions(){if(!logged(()=>showRedemptions()))return;go('redemptions');void refresh().catch(()=>tell('兑换记录刷新失败，请稍后刷新重试'))}
function openPassword(){clearCredentials();authError.value='';modal.value='password'}
async function changePassword(){
 authError.value=''
 if(!validPassword(currentPassword.value)||!validPassword(newPassword.value)){authError.value='原密码和新密码均需为 12–128 个字符';return}
 if(newPassword.value!==newPasswordConfirm.value){authError.value='两次输入的新密码不一致';return}
 if(currentPassword.value===newPassword.value){authError.value='新密码应与原密码不同';return}
 await act(async()=>{
  try{
   const r=await request('/auth/password','POST',{currentPassword:currentPassword.value,newPassword:newPassword.value})
   uni.setStorageSync('aurora-token',r.token);refreshVersion++;user.value=r.user;clearCredentials();modal.value=''
   await syncSuccess('密码已修改，其他旧会话已失效')
  }catch(e:any){authError.value=e.message||'修改失败，请稍后重试'}
 })
}
async function logout(){await act(async()=>{
 let revoked=true
 try{await request('/auth/logout','POST',{})}catch{revoked=false}
 uni.removeStorageSync('aurora-token');refreshVersion++;afterLogin=null;resetAccount();checkoutItems.value=[];clearCredentials();username.value='';authMode.value='demo';go('home')
 tell(revoked?'已退出登录':'本机已退出；网络异常，服务端会话可能仍有效')
})}
watch(modal,(value,previous)=>{if(value!==previous){authError.value='';if(value!=='login'&&value!=='password')clearCredentials()}})

function openProduct(p:ShopProduct){selected.value=p;modal.value='product'}
async function addCart(p:ShopProduct){if(!logged(()=>addCart(p)))return;if(unavailable(p)){tell('商品已下架或库存不足');return}await act(async()=>{const quantity=(cart.value.find(c=>c.id===p.id)?.quantity||0)+1;await request('/cart','POST',{productId:p.id,quantity});modal.value='';await syncSuccess('已加入购物车')})}
async function changeQty(p:any,delta:number){if(p.quantity+delta<1||unavailable(p))return;await act(async()=>{await request('/cart','POST',{productId:p.id,quantity:p.quantity+delta});await syncSuccess('购物车数量已更新')})}
async function removeCart(p:any){await act(async()=>{await request('/cart/remove','POST',{productId:p.id});await syncSuccess('已移除商品')})}
function openCheckout(items:any[]){
 if(!logged(()=>openCheckout(items)))return
 if(!items.length){tell('先挑选一件喜欢的商品吧');return}
 if(items.some(p=>unavailable(p)||p.quantity>p.stock)){tell('购物车中有已下架或库存不足商品，请调整后结算');return}
 checkoutItems.value=items.map(p=>({...p,quantity:p.quantity||1}));couponId.value='';checkoutKey.value=idempotencyKey();modal.value='';active.value='checkout';uni.pageScrollTo({scrollTop:0,duration:100})
}
async function submitOrder(){if(!selectedAddress.value){modal.value='addresses';return}await act(async()=>{
 const r=await request('/shop/checkout','POST',{items:checkoutItems.value.map(p=>({productId:p.id,quantity:p.quantity})),addressId:addressId.value,couponId:couponId.value,requestKey:checkoutKey.value});payOrder.value=r.order;checkoutItems.value=[];active.value='orders';orderQuery.value='';orderFilter.value='待付款';modal.value='pay';await syncSuccess('订单已创建，请核对应付金额后测试付款')
})}
async function pay(){if(!payOrder.value)return;await act(async()=>{await request(`/shop/orders/${payOrder.value.id}/demo-pay`,'POST',{});modal.value='';orderFilter.value='待发货';await syncSuccess('测试付款完成，未实际扣款；请等待商家登记发货')})}
async function orderAction(o:any,action:'receive'|'cancel'){await act(async()=>{await request(`/shop/orders/${o.id}/${action}`,'POST',{});orderFilter.value='全部';await syncSuccess(action==='receive'?`确认收货成功，按订单规则入账 ${o.reward} 积分`:'订单已取消，库存已释放')})}
async function submitAfterSale(){
 if(!payOrder.value)return
 const reason=afterSaleReason.value.trim()
 if(reason.length<5){tell('请填写至少 5 个字的售后原因');return}
 await act(async()=>{await request(`/shop/orders/${payOrder.value.id}/after-sales`,'POST',{reason});modal.value='';afterSaleReason.value='';orderFilter.value='全部';await syncSuccess('售后申请已提交，等待商家审核；尚未完成退款')})
}
function requestAfterSale(o:any){payOrder.value=o;afterSaleReason.value='';modal.value='afterSale'}
async function saveAddress(){await act(async()=>{const r=await request('/addresses','POST',{recipient:recipient.value.trim(),phone:phone.value.trim(),detail:detail.value.trim()});addressId.value=r.id;recipient.value='';phone.value='';detail.value='';modal.value='addresses';await syncSuccess('地址已保存')})}
async function removeAddress(id:string){await act(async()=>{await request('/addresses/remove','POST',{id});await syncSuccess('地址已删除')})}
async function redeem(){if(!selected.value||!logged(()=>redeem()))return;await act(async()=>{const p=selected.value!;await request('/orders','POST',{productId:p.id,requestKey:checkoutKey.value||idempotencyKey()});checkoutKey.value='';modal.value='';await syncSuccess(p.id==='coupon'?'兑换成功，购物券已放入我的优惠券':'积分兑换已记录；当前不真实发货')})}
function redeemProduct(p:ShopProduct){selected.value=p;checkoutKey.value=idempotencyKey();modal.value='redeem'}
async function checkin(){if(!logged(()=>checkin()))return;await act(async()=>{const r=await request('/checkin','POST',{});await syncSuccess(`签到成功，获得 ${r.reward} 积分`)})}
async function startAd(){if(!logged(()=>startAd()))return;await act(async()=>{ad.value=await request('/ads/start','POST',{});seconds.value=ad.value.minimumSeconds;modal.value='ad';if(adTimer)clearInterval(adTimer);const end=Date.now()+seconds.value*1000;adTimer=setInterval(()=>{seconds.value=Math.max(0,Math.ceil((end-Date.now())/1000));if(!seconds.value&&adTimer)clearInterval(adTimer)},250)})}
async function claimAd(){if(seconds.value||!ad.value)return;await act(async()=>{await request('/ads/claim','POST',{sessionId:ad.value.id});modal.value='';await syncSuccess('30 演示积分已到账')})}
function close(){if(modal.value==='info'&&infoReturnModal.value){modal.value=infoReturnModal.value;infoReturnModal.value='';return}if(modal.value==='login')afterLogin=null;modal.value='';if(adTimer)clearInterval(adTimer)}
function favorite(p:ShopProduct){favorites.value=favorites.value.includes(p.id)?favorites.value.filter(id=>id!==p.id):[...favorites.value,p.id];uni.setStorageSync('aurora-favorites',favorites.value);tell(favorites.value.includes(p.id)?'已收藏':'已取消收藏')}
function showOrders(filter='全部'){if(!logged(()=>showOrders(filter)))return;orderFilter.value=filter;orderQuery.value='';go('orders');void refresh().catch(()=>tell('订单刷新失败，请稍后点击刷新重试'))}
function rules(){info('购物积分规则',`当前购物奖励：${rateDescription.value}，按优惠后实付金额计算并向下取整。结算页为当前规则预估，实际以创建订单时服务端记录的积分为准，后续规则调整不修改已有订单。付款后积分待入账，商家登记发货并确认收货后到账。取消订单不发积分；售后需商家审核，批准退款会回收已发购物积分。已使用返还积分导致余额不足时，需继续人工处理，不会自动制造负积分。签到和广告仅为补充任务。积分不出售、不提现、不转让，不参与随机抽奖。当前全部为测试交易，不扣款、不真实发货。`)}
function privacy(){info('隐私与体验说明','本测试版保存随机体验账户或注册账号、密码安全摘要、登录会话、地址、购物车、订单、售后原因、商家手工登记的运单信息、积分、优惠券和安全操作记录。请只填写虚构的收货信息，不输入真实隐私；售后原因中不要填写身份证、银行卡或密码。心愿单保存在本设备。未接入支付、物流、广告或数美 SDK，不向这些平台发送数据。运单是商家录入记录，不是物流平台实时追踪。正式运营前需补充运营主体、数据保留与删除、注销和申诉等完整政策。')}
function admin(){uni.navigateTo({url:'/pages/admin/index'})}
const date=(n:number)=>new Date(n).toLocaleString('zh-CN',{hour12:false})
onMounted(load)
onUnmounted(()=>{refreshVersion++;if(noticeTimer)clearTimeout(noticeTimer);if(adTimer)clearInterval(adTimer)})
</script>

<template>
 <view class="mall">
  <view class="m-topline"><view class="m-width"><text>好物认真选 · 购物有积分</text><view><text class="m-test-badge">测试商城 · 不真实扣款</text><text @click="rules">积分规则</text><text @click="admin">商家后台 ↗</text></view></view></view>
  <view class="m-header"><view class="m-width m-header-inner"><view class="m-brand" @click="go('home')"><text class="m-brand-symbol">曜</text><view><text class="m-brand-title">曜集商城</text><text class="m-brand-sub">买好物 · 得积分 · 兑好礼</text></view></view><view class="m-search"><text>⌕</text><input v-model="query" placeholder="搜好物，看看能得多少积分" @confirm="active='category'"/><button role="button" @click="active='category'">搜索</button></view><view class="m-header-account" @click="user?go('mine'):modal='login'"><text class="m-account-icon">♙</text><view><text>{{user?'我的账户':'登录 / 注册'}}</text><text class="m-muted">{{user?`${pointBalance} 可用积分`:'开启购物积分体验'}}</text></view></view><view class="m-header-cart" @click="go('cart')">▱<text>购物车</text><text class="m-cart-badge">{{cartCount}}</text></view></view></view>
  <view class="m-desktop-nav"><view class="m-width"><view v-for="n in nav" :key="n.id" role="button" :aria-label="n.label" :data-testid="'customer-nav-'+n.id" :class="{on:active===n.id}" @click="go(n.id)">{{n.label}}</view><view :class="{on:active==='tasks'}" @click="go('tasks')">签到领积分</view><text class="m-nav-tip">购物返积分，确认收货后到账</text></view></view>
  <view class="m-width m-main">
   <view v-if="loading" class="m-empty"><text class="m-empty-symbol">◌</text><text>正在准备你的购物首页…</text></view>
   <view v-else-if="error" class="m-empty"><text>商城服务暂时无法连接</text><text class="m-muted">{{error}}</text><button role="button" class="m-button" @click="load">重新连接</button></view>
   <template v-else>
    <view v-if="accountSyncError" class="m-sync-warning"><text>{{accountSyncError}}</text><button role="button" class="m-button m-button-outline" :disabled="busy" @click="act(refresh)">刷新账户</button></view>
    <template v-if="active==='home'">
     <view class="m-home-top"><view class="m-hero"><view class="m-hero-copy"><view class="m-hero-pill">SHOP & EARN / 购物积分计划</view><text class="m-hero-title">{{purchaseRate?'每一笔购物':'好物认真挑选'}}<br/>{{purchaseRate?'都有积分回礼':'让日常更有质感'}}</text><text class="m-hero-sub">好物买回家，积分留给下一份惊喜。</text><view class="m-hero-actions"><button role="button" @click="go('category')">去逛好物 <text>↗</text></button><text @click="rules">购物返积分规则 →</text></view><view class="m-hero-steps"><text>01 挑选好物</text><text>→</text><text>02 确认收货</text><text>→</text><text>03 积分兑礼</text></view></view><view class="m-hero-art"><image src="/static/shop-hero.svg" mode="aspectFit"/></view><text class="m-hero-stamp">GOOD FINDS.<br/>MORE REWARDS.</text></view><view class="m-member-card"><view class="m-member-top"><text>曜集会员 · 积分账户</text><text>◇</text></view><view class="m-member-balance">{{pointBalance}}<text>可用积分</text></view><text class="m-member-pending">{{user?`待入账 ${user.pendingPoints} 积分`:'登录后查看购物积分'}}</text><view class="m-member-buttons"><button role="button" @click="user?go('points'):modal='login'">{{user?'积分兑换':'登录体验'}} ↗</button><text @click="go('wallet')">查看明细 →</text></view><view class="m-member-foot"><text>每满 ¥1</text><text>{{purchaseRate?`返 ${purchaseRate} 积分`:'暂停返积分'}}</text><text>确认收货后到账</text></view></view></view>
     <view class="m-service-strip"><text>▣ 购物得积分</text><text>◇ 积分兑好礼</text><text>▤ 订单可追踪</text><text>✓ 规则透明可查</text></view>
     <view class="m-category-shortcuts"><view v-for="(c,i) in [{name:'数码好物',icon:'◉',tone:'peach'},{name:'生活美学',icon:'⌂',tone:'mint'},{name:'出行装备',icon:'▱',tone:'purple'},{name:'积分兑礼',icon:'◇',tone:'gold'},{name:'每日签到',icon:'✓',tone:'rose'}]" :key="i" @click="c.name==='积分兑礼'?go('points'):c.name==='每日签到'?go('tasks'):(go('category'),category=c.name)"><view :class="'m-category-icon '+c.tone">{{c.icon}}</view><text>{{c.name}}</text></view></view>
     <view class="m-feature-row"><view class="m-feature m-feature-coupon" @click="go('points')"><view><text class="m-feature-eyebrow">POINTS TO PERKS</text><text class="m-feature-title">积分换券，下单更划算</text><text class="m-feature-sub">300 积分兑换满 200 减 20 购物券</text><text class="m-feature-link">去兑换 →</text></view><view class="m-feature-ticket"><text>¥<text>20</text></text><text>满200可用</text></view></view><view class="m-feature m-feature-task" @click="go('tasks')"><view><text class="m-feature-eyebrow">A LITTLE EXTRA</text><text class="m-feature-title">日常小任务，积分加一点</text><text class="m-feature-sub">每日签到 · 激励体验 · 明细可查</text><text class="m-feature-link">去领积分 →</text></view><text class="m-feature-orb">✧</text></view></view>
    </template>

    <template v-if="['home','category','points'].includes(active)">
     <view v-if="active==='points'" class="m-points-hero"><view><text class="m-eyebrow">POINTS MALL / 积分商城</text><text class="m-page-title">把购物积累，兑成喜欢</text><text class="m-muted">积分兑换优惠券或好礼，兑换价格明确，无随机抽奖。</text></view><view class="m-points-balance" @click="go('wallet')">{{pointBalance}}<text>可用积分 · 查看明细 →</text></view></view>
     <view class="m-section-heading"><view><text class="m-section-title">{{active==='home'?'精选好物 · 购物得积分':active==='points'?'积分好礼':'全部商品'}}</text><text class="m-section-sub">{{active==='points'?'购物确认收货后，积分可用':'价格看得见，返积分也看得见'}}</text></view><text class="m-text-link" @click="active==='home'?go('category'):rules()">{{active==='home'?'查看全部 →':'积分规则 ↗'}}</text></view>
     <view class="m-filter"><view class="m-filter-categories"><view v-for="c in active==='points'?[...categories,'专属权益']:categories" :key="c" :class="{on:category===c}" @click="category=c">{{c}}</view></view><view class="m-sort"><text :class="{on:sort==='综合'}" @click="sort='综合'">综合</text><text :class="{on:sort==='价格升序'||sort==='低积分优先'}" @click="sort=active==='points'?'低积分优先':'价格升序'">{{active==='points'?'积分 ↑':'价格 ↑'}}</text><text v-if="active!=='points'" :class="{on:sort==='返积分优先'}" @click="sort='返积分优先'">返积分 ↓</text></view></view>
     <view v-if="!shown.length" class="m-empty"><text>没有找到匹配的商品</text><button role="button" class="m-button m-button-soft" @click="query='';category='全部'">查看全部商品</button></view>
     <view class="m-product-grid"><ShopProductCard v-for="p in shown" :key="p.id" :product="p" :points-mode="active==='points'" @open="active==='points'?redeemProduct(p):openProduct(p)" @add="active==='points'?redeemProduct(p):addCart(p)"/></view>
     <view v-if="active==='home'" class="m-bottom-story"><text>好物值得拥有，积分不止这一次。</text><view @click="go('points')">去积分商城，发现下一份好礼 →</view></view>
    </template>

    <template v-if="active==='cart'">
     <view class="m-section-heading"><view><text class="m-page-title">购物车<text class="m-title-count">{{cartCount}} 件</text></text><text class="m-muted">确认收货后获得购物积分，优惠券可在结算时选择。</text></view><text class="m-text-link" @click="go('category')">继续逛逛 →</text></view>
     <view v-if="!cart.length" class="m-empty m-white"><text class="m-empty-symbol">▱</text><text>购物车还是空的</text><text class="m-muted">选一件喜欢的好物，开启购物积分之旅。</text><button role="button" class="m-button" @click="go('category')">去挑选好物</button></view>
     <view v-else class="m-cart-layout"><view class="m-panel"><view class="m-cart-table-head"><text>商品信息</text><text>数量 / 小计</text></view><view v-for="p in cart" :key="p.id" class="m-cart-item"><image :src="photo(p.art)" mode="aspectFill" @click="openProduct(p)"/><view class="m-cart-item-info"><text class="m-item-title">{{p.name}}<text v-if="p.enabled===false||p.enabled===0" class="m-unavailable-label">已下架</text></text><text class="m-muted">单价 ¥{{money(p.price)}} · 确认收货返积分</text><text class="m-reward-label">预计返 {{estimatedPoints(p.price*p.quantity)}} 积分</text><text class="m-remove" @click="removeCart(p)">移除</text></view><view class="m-cart-item-end"><text class="m-item-price">¥{{money(p.price*p.quantity)}}</text><view class="m-stepper"><button role="button" aria-label="减少数量" :disabled="busy||unavailable(p)||p.quantity<=1" @click="changeQty(p,-1)">−</button><text>{{p.quantity}}</text><button role="button" aria-label="增加数量" :disabled="busy||unavailable(p)||p.quantity>=20||p.quantity>=p.stock" @click="changeQty(p,1)">＋</button></view></view></view></view><view class="m-summary"><text class="m-section-title">订单预估</text><view><text>商品金额</text><text>¥{{money(cartTotal)}}</text></view><view><text>运费</text><text>¥0.00</text></view><view class="m-summary-total"><text>合计</text><text>¥{{money(cartTotal)}}</text></view><view class="m-summary-reward">确认收货预计返 {{estimatedPoints(cartTotal)}} 积分</view><button role="button" class="m-button m-wide" @click="openCheckout(cart)">去结算（{{cartCount}}）</button><text class="m-summary-note">测试商城不扣款，不产生真实发货。</text></view></view>
    </template>

    <template v-if="active==='checkout'">
     <view class="m-section-heading"><view><text class="m-page-title">确认订单</text><text class="m-muted">商品、优惠、返积分，提交前一次看清楚。</text></view><text class="m-text-link" @click="go('cart')">返回购物车</text></view>
     <view class="m-checkout-layout"><view><view class="m-address-card" @click="modal='addresses'"><text class="m-address-pin">⌖</text><view v-if="selectedAddress" class="m-grow"><text class="m-item-title">{{selectedAddress.recipient}} <text class="m-muted-inline">{{selectedAddress.phone}}</text></text><text class="m-muted">{{selectedAddress.detail}}</text></view><view v-else class="m-grow"><text class="m-item-title">选择收货地址</text><text class="m-muted">当前为测试，请仅填写虚构信息</text></view><text>›</text></view><view class="m-panel"><view v-for="p in checkoutItems" :key="p.id" class="m-checkout-item"><image :src="photo(p.art)" mode="aspectFill"/><view class="m-grow"><text class="m-item-title">{{p.name}}</text><text class="m-muted">¥{{money(p.price)}} × {{p.quantity}}</text></view><text class="m-item-price">¥{{money(p.price*p.quantity)}}</text></view></view><view class="m-panel m-coupon-select"><text class="m-section-title">使用优惠券</text><view class="m-coupon-option" :class="{on:!couponId}" @click="couponId=''"><text>{{!couponId?'●':'○'}}</text><text>不使用优惠券</text></view><view v-for="c in availableCoupons" :key="c.id" class="m-coupon-option" :class="{on:couponId===c.id}" @click="couponId=c.id"><text>{{couponId===c.id?'●':'○'}}</text><text>满 ¥{{money(c.threshold)}} 减 ¥{{money(c.discount)}}</text></view><text v-if="!availableCoupons.length" class="m-muted">暂无符合使用条件的优惠券，可到积分商城兑换。</text></view></view><view class="m-summary"><text class="m-section-title">结算明细</text><view><text>商品总额</text><text>¥{{money(subtotal)}}</text></view><view><text>优惠券</text><text class="m-orange">−¥{{money(discount)}}</text></view><view><text>运费</text><text>¥0.00</text></view><view class="m-summary-total"><text>应付</text><text>¥{{money(payable)}}</text></view><view class="m-summary-reward">确认收货返 {{estimatedPoints(payable)}} 积分</view><button role="button" class="m-button m-wide" :disabled="busy" @click="submitOrder">提交订单</button><text class="m-summary-note">奖励按当前规则预估，订单创建后以服务端记录为准。下一步为测试付款，不调用真实支付。</text></view></view>
    </template>

    <template v-if="active==='orders'">
     <view class="m-section-heading"><text class="m-page-title">我的订单</text><view class="m-order-header-actions"><text class="m-text-link" @click="go('category')">继续购物 →</text><button role="button" class="m-button m-button-outline" :disabled="busy" @click="act(refresh)">刷新订单</button></view></view><view class="m-order-tabs"><view v-for="s in ['全部','待付款','待发货','待收货','已完成','售后中','已退款','已取消']" :key="s" :class="{on:orderFilter===s}" @click="orderFilter=s">{{s}}</view></view><view class="m-order-search"><view class="m-order-search-field"><text aria-hidden="true">⌕</text><input v-model="orderQuery" aria-label="搜索订单号或商品名称" placeholder="搜索订单号或商品名称" maxlength="100" confirm-type="search"/><button v-if="orderQuery" role="button" aria-label="清空订单搜索" @click="orderQuery=''">清空</button></view><text class="m-order-result-count" aria-live="polite">{{orderFilter==='全部'?'全部订单':orderFilter}} · {{visibleOrders.length}} 笔</text></view><view v-if="!visibleOrders.length" class="m-empty m-white"><text>{{orderEmptyTitle}}</text><text class="m-muted">{{normalizedOrderQuery?'试试订单号中的部分数字，或换一个商品名称。':orderFilter==='全部'?'心仪好物下单后，可在这里查看进度与积分。':'你可以切换到全部订单查看其他进度。'}}</text><button v-if="normalizedOrderQuery||orderFilter!=='全部'" role="button" class="m-button m-button-outline" @click="clearOrderFilters">查看全部订单</button><button v-else role="button" class="m-button" @click="go('category')">去逛逛</button></view><view v-for="o in visibleOrders" :key="o.id" class="m-order-card"><view class="m-order-top"><text>{{o.number}}<text class="m-order-date">{{date(o.created_at)}}</text></text><text class="m-order-status">{{orderStatus[o.status]}}</text></view><view v-for="p in o.items" :key="p.product_id" class="m-order-product"><image :src="photo(p.art)" mode="aspectFill"/><view class="m-grow"><text class="m-item-title">{{p.name}}</text><text class="m-muted">¥{{money(p.price)}} × {{p.quantity}}</text></view><text class="m-item-price">¥{{money(p.price*p.quantity)}}</text></view><view class="m-order-total"><text class="m-reward-label">{{o.status==='completed'?'已返':o.status==='cancelled'||o.status==='refunded'?'不保留':'待入账'}} {{o.reward}} 积分</text><text>订单金额 <text class="m-item-price">¥{{money(o.amount)}}</text></text></view><view v-if="o.shipment" class="m-shipment-card"><view class="m-shipment-heading"><text>商家发货记录</text><text class="m-mini-badge">手工登记 · 非实时物流</text></view><view><text>承运商</text><text>{{o.shipment.carrier}}</text></view><view><text>运单号</text><text class="m-tracking-number">{{o.shipment.tracking}}</text></view><text class="m-muted">登记时间 {{date(o.shipment.created_at)}}</text></view><view v-if="o.afterSale" class="m-after-sale" :class="'is-'+o.afterSale.status"><view class="m-after-sale-heading"><text>售后申请</text><text>{{afterSaleStatus[o.afterSale.status]||o.afterSale.status}}</text></view><text class="m-after-sale-reason">申请原因：{{o.afterSale.reason}}</text><text v-if="o.afterSale.resolution" class="m-after-sale-resolution">商家说明：{{o.afterSale.resolution}}</text><text class="m-muted">{{date(o.afterSale.created_at)}} · {{o.afterSale.status==='pending'?'待商家审核，订单与积分尚未退款回滚':'测试售后记录，不涉及真实资金退款'}}</text></view><view class="m-order-actions"><text class="m-muted">测试交易 · 无真实支付/物流</text><button v-if="o.status==='pending'" role="button" class="m-button m-button-outline" :disabled="busy" @click="orderAction(o,'cancel')">取消订单</button><button v-if="o.status==='pending'" role="button" class="m-button" @click="payOrder=o;modal='pay'">测试付款</button><text v-if="o.status==='paid'" class="m-await-shipment">等待商家登记发货</text><button v-if="o.status==='shipped'" role="button" class="m-button" :disabled="busy||o.afterSale?.status==='pending'" @click="orderAction(o,'receive')">{{o.reward?'确认收货，领积分':'确认收货'}}</button><button v-if="['paid','shipped','completed'].includes(o.status)&&!o.afterSale" role="button" class="m-button m-button-outline" :disabled="busy" @click="requestAfterSale(o)">申请售后</button></view></view>
    </template>

    <template v-if="active==='mine'">
     <view class="m-profile"><view class="m-profile-avatar">曜</view><view class="m-grow"><text class="m-page-title">{{user?.username|| (user?'曜集会员':'欢迎来到曜集商城')}}</text><text class="m-muted">{{user?(user.hasPassword?'账号已保存，可使用账号密码再次登录':'匿名体验账户 · 退出后无法凭账号找回'):'登录后管理订单、收货地址和购物积分'}}</text></view><button role="button" class="m-button m-button-outline" @click="user?logout():modal='login'">{{user?'退出登录':'登录 / 注册'}}</button></view><view class="m-account-stats"><view @click="go('wallet')"><text>{{pointBalance}}</text><text>可用积分 →</text></view><view @click="showOrders()"><text>{{user?.pendingPoints||0}}</text><text>待入账积分 →</text></view><view @click="go('coupons')"><text>{{coupons.filter(c=>c.status==='available').length}}</text><text>可用优惠券 →</text></view><view @click="modal='favorites'"><text>{{favorites.length}}</text><text>我的收藏 →</text></view></view><view class="m-panel"><view class="m-section-heading"><text class="m-section-title">我的订单</text><text class="m-text-link" @click="showOrders()">全部订单 →</text></view><view class="m-order-shortcuts"><view v-for="(s,i) in ['待付款','待发货','待收货','已完成','已退款']" :key="s" @click="showOrders(s)"><text>{{['▤','▣','▱','✓','↶'][i]}}</text><text>{{s}}</text><text class="m-order-count">{{orders.filter(o=>orderStatus[o.status]===s).length}}</text></view></view></view><view class="m-personal-links"><view data-testid="account-redemptions-entry" @click="showRedemptions">积分兑换记录 <text>›</text></view><view v-if="user?.hasPassword" data-testid="account-password-entry" @click="openPassword">修改登录密码 <text>›</text></view><view @click="logged()&&(modal='addresses')">收货地址 <text>›</text></view><view @click="go('coupons')">我的优惠券 <text>›</text></view><view @click="go('tasks')">签到与广告激励 <text>›</text></view><view @click="rules">购物积分规则 <text>›</text></view><view @click="privacy">隐私与体验说明 <text>›</text></view><view @click="admin">商家运营后台 <text>›</text></view></view>
    </template>

    <template v-if="active==='redemptions'">
     <view class="m-section-heading"><text class="m-page-title">积分兑换记录</text><button role="button" class="m-button m-button-outline" :disabled="busy" @click="act(refresh)">刷新兑换记录</button></view>
     <view class="m-note">购物券兑换后自动放入“我的优惠券”。实物兑换仅记录测试申请，由商家登记处理说明，不代表真实发货或物流跟踪。</view>
     <view v-if="!redemptions.length" class="m-empty m-white"><text>还没有积分兑换记录</text><text class="m-muted">积分兑换购物券或好礼后，可在这里查看处理状态。</text><button role="button" class="m-button" @click="go('points')">去积分商城</button></view>
     <view v-for="r in redemptions" :key="r.id" class="m-redemption-card" :data-redemption-id="r.id"><view class="m-redemption-heading"><view><text class="m-item-title">{{r.name}}</text><text class="m-muted">{{date(r.created_at)}}</text></view><text class="m-mini-badge">{{r.product_id==='coupon'?'已发放购物券':r.fulfillment?'商家已记录处理':'待商家处理'}}</text></view><view class="m-redemption-points">支出 {{r.points}} 积分</view><view v-if="r.fulfillment" class="m-redemption-note"><text>商家处理说明</text><text>{{r.fulfillment.note}}</text><text class="m-muted">{{date(r.fulfillment.created_at)}} · 测试处理记录，非真实物流</text></view><view v-else-if="r.product_id==='coupon'" class="m-redemption-note"><text>已发放至该账号的优惠券，请查看门槛、有效期和使用状态。</text><button role="button" class="m-button m-button-outline" @click="go('coupons')">查看我的优惠券</button></view><view v-else class="m-redemption-note"><text>商家尚未登记处理结果，请稍后刷新查看。</text></view></view>
    </template>

    <template v-if="active==='wallet'">
     <view class="m-wallet-banner"><view><text>我的购物积分</text><text class="m-wallet-number">{{pointBalance}}</text><text>另有 {{user?.pendingPoints||0}} 积分待确认收货后入账</text></view><button role="button" class="m-button" @click="go('points')">去兑换好礼 →</button></view><view class="m-section-heading"><text class="m-section-title">积分收支明细</text><text class="m-text-link" @click="rules">规则说明</text></view><view class="m-panel"><view v-if="!ledger.length" class="m-empty"><text>还没有积分记录</text><text class="m-muted">购物确认收货后即可获得积分，也可以参与签到。</text></view><view v-for="l in ledger" :key="l.id" class="m-ledger-row"><text class="m-ledger-icon">{{l.delta>0?'↙':'↗'}}</text><view class="m-grow"><text class="m-item-title">{{l.label}}</text><text class="m-muted">{{date(l.created_at)}}</text></view><text class="m-ledger-delta" :class="{positive:l.delta>0}">{{l.delta>0?'+':''}}{{l.delta}}</text></view></view>
    </template>

    <template v-if="active==='coupons'">
     <view class="m-section-heading"><text class="m-page-title">我的优惠券</text><text class="m-text-link" @click="go('points')">积分兑券 →</text></view><view v-if="!coupons.length" class="m-empty m-white"><text>还没有优惠券</text><text class="m-muted">购物积累积分后，可到积分商城兑换购物券。</text><button role="button" class="m-button" @click="go('points')">去积分商城</button></view><view class="m-coupons-grid"><view v-for="c in coupons" :key="c.id" class="m-coupon" :class="{unavailable:c.status!=='available'}"><view class="m-coupon-value">¥<text>{{c.discount/100}}</text></view><view class="m-grow"><text class="m-item-title">满 {{c.threshold/100}} 元购物券</text><text class="m-muted">有效期至 {{date(c.expires_at)}}</text><text class="m-orange">{{c.status==='available'?'可使用':c.status==='used'?'已使用':'已过期'}}</text></view><button v-if="c.status==='available'" role="button" class="m-button m-button-soft" @click="go('category')">去使用</button></view></view>
    </template>

    <template v-if="active==='tasks'">
     <view class="m-task-banner"><view><text class="m-eyebrow">DAILY REWARDS</text><text class="m-page-title">购物之外，多积一点</text><text class="m-muted">每日签到与自愿广告体验，作为购物积分的补充。</text></view><text>✳</text></view><view class="m-panel"><view class="m-section-heading"><text class="m-section-title">每日签到</text><text class="m-orange">连续 {{user?.streak||0}} 天</text></view><view class="m-sign-days"><view v-for="d in 7" :key="d"><text>第 {{d}} 天</text><text>✦</text><text>+{{d===7?100:20}}</text></view></view><button role="button" class="m-button m-wide" :disabled="busy||user?.checkedIn" :aria-disabled="busy||user?.checkedIn" @click="checkin">{{user?.checkedIn?'今日已签到':'签到领取积分'}}</button></view><view class="m-task-row"><view class="m-task-video">▷</view><view class="m-grow"><text class="m-item-title">看广告激励 <text class="m-mini-badge">内部演示</text></text><text class="m-muted">完成 8 秒演示得 30 积分 · 今日 {{user?.adCount||0}} / 5 次</text></view><button role="button" class="m-button m-button-soft" :disabled="busy||!adsEnabled||(user?.adCount||0)>=5" @click="startAd">去体验</button></view><view class="m-note">真实广告未接入。当前不会调用穿山甲或微信广告，也不产生广告收益。不提供朋友圈分享奖励。</view>
    </template>
    <AdPlacement v-for="p in placements.filter(p=>p.position===active)" :key="p.id" :name="p.name" :format="p.format" @explore="startAd"/>
    <view class="m-footer"><view><text>曜集商城</text><text>买好物 · 得积分 · 兑好礼</text></view><view><text @click="rules">积分规则</text><text @click="privacy">隐私说明</text><text @click="admin">商家后台</text></view><text>测试版 · 商品图片仅作展示 · 不产生真实交易</text></view>
   </template>
  </view>
  <view class="m-mobile-nav"><view v-for="n in nav" :key="n.id" role="button" :aria-label="n.label" :data-testid="'customer-nav-'+n.id" :class="{on:active===n.id}" @click="go(n.id)"><view><text>{{n.icon}}</text><text v-if="n.id==='cart'&&cartCount" class="m-cart-badge">{{cartCount}}</text></view><text>{{n.short}}</text></view></view>

  <view v-if="modal" class="m-modal-mask" @click="close"><view class="m-modal" :class="{'m-detail-modal':modal==='product'}" @click.stop><view class="m-modal-close" role="button" aria-label="关闭弹窗" @click="close">×</view>
   <template v-if="modal==='login'">
    <view class="m-login-mark">曜</view><text class="m-eyebrow">WELCOME TO YAOJI</text><text class="m-modal-title">开启你的购物积分账户</text>
    <view class="m-auth-tabs"><button v-for="tab in [{id:'demo',label:'匿名体验'},{id:'login',label:'账号登录'},{id:'register',label:'注册账号'}]" :key="tab.id" role="button" :data-testid="'account-tab-'+tab.id" :class="{on:authMode===tab.id}" :disabled="busy" @click="switchAuthMode(tab.id as 'demo'|'login'|'register')">{{tab.label}}</button></view>
    <text v-if="authMode==='demo'" class="m-modal-desc">{{rateDescription}}，购物积分在确认收货后入账。账户初始积分为 0。匿名体验退出后无法凭账号找回；如需再次登录同一账户，请选择注册账号。</text>
    <template v-else><text class="m-modal-desc">{{authMode==='register'?'创建账号后，可用账号密码再次登录；新账号积分从 0 开始，不合并匿名体验数据。':'使用已有账号登录，继续查看该账号的订单、优惠券和积分。'}}</text><view class="m-form m-auth-form"><text>账号</text><input v-model="username" data-testid="account-username" aria-label="账号" placeholder="3–32 位英文字母、数字或下划线" maxlength="32" :disabled="busy"/><text>密码</text><input v-model="password" data-testid="account-password" aria-label="密码" placeholder="12–128 个字符" :password="true" maxlength="128" :disabled="busy" @confirm="authMode==='login'&&accountLogin()"/><template v-if="authMode==='register'"><text>再次输入密码</text><input v-model="passwordConfirm" data-testid="account-password-confirm" aria-label="再次输入密码" placeholder="再次输入密码" :password="true" maxlength="128" :disabled="busy" @confirm="accountLogin"/></template></view><text class="m-auth-safety">暂不提供密码找回，请妥善保管账号和密码。不要使用其他网站的密码。</text></template>
    <view v-if="authMode!=='login'" class="m-consent" @click="!busy&&(consent=!consent)"><text class="m-check" :class="{on:consent}">{{consent?'✓':''}}</text><text>我同意本商城为测试版，不真实扣款或发货，并已阅读</text><text class="m-orange" @click.stop="privacy">隐私说明</text></view>
    <text v-if="authError" class="m-auth-error" role="alert">{{authError}}</text>
    <button v-if="authMode==='demo'" role="button" class="m-button m-wide" :disabled="busy" @click="login">同意并登录体验</button><button v-else role="button" class="m-button m-wide" data-testid="account-submit" :disabled="busy" @click="accountLogin">{{busy?'正在处理…':authMode==='register'?'同意并创建账号':'登录账号'}}</button>
   </template>
   <template v-else-if="modal==='password'"><text class="m-eyebrow">ACCOUNT SECURITY</text><text class="m-modal-title">修改登录密码</text><text class="m-modal-desc">账号 {{user?.username}}。修改成功后，其他设备和旧登录会话将失效，当前设备保留登录。</text><view class="m-form m-auth-form"><text>原密码</text><input v-model="currentPassword" data-testid="account-current-password" aria-label="原密码" placeholder="输入原密码" :password="true" maxlength="128" :disabled="busy"/><text>新密码</text><input v-model="newPassword" data-testid="account-new-password" aria-label="新密码" placeholder="12–128 个字符，与原密码不同" :password="true" maxlength="128" :disabled="busy"/><text>再次输入新密码</text><input v-model="newPasswordConfirm" data-testid="account-new-password-confirm" aria-label="再次输入新密码" placeholder="再次输入新密码" :password="true" maxlength="128" :disabled="busy" @confirm="changePassword"/></view><text class="m-auth-safety">暂不支持密码找回，请妥善保存新密码。</text><text v-if="authError" class="m-auth-error" role="alert">{{authError}}</text><button role="button" class="m-button m-wide" data-testid="account-password-save" :disabled="busy" @click="changePassword">{{busy?'正在处理…':'确认修改密码'}}</button></template>
   <template v-else-if="modal==='product'&&selected"><image class="m-detail-image" :src="photo(selected.art)" mode="aspectFill"/><view class="m-detail-content"><view class="m-detail-price"><text>¥{{money(selected.price)}}</text><text>确认收货返 {{selected.rewardPoints}} 积分</text></view><text class="m-modal-title">{{selected.name}}</text><text class="m-modal-desc">{{selected.subtitle}}</text><view class="m-detail-spec"><view><text>服务</text><text>测试包邮 · 库存 {{selected.stock}} 件</text></view><view><text>积分</text><text>{{rateDescription}}，以优惠后金额和订单记录为准</text></view><view><text>说明</text><text>图片为示意，不代表实际商品型号或品牌授权</text></view></view><view class="m-detail-actions"><button role="button" class="m-favorite-button" @click="favorite(selected)">{{favorites.includes(selected.id)?'♥ 已收藏':'♡ 收藏'}}</button><button role="button" class="m-button m-button-soft" :disabled="busy||unavailable(selected)" @click="addCart(selected)">加入购物车</button><button role="button" class="m-button" :disabled="unavailable(selected)" @click="openCheckout([selected])">立即购买</button></view></view></template>
   <template v-else-if="modal==='redeem'&&selected"><image class="m-redeem-image" :src="photo(selected.art)" mode="aspectFit"/><text class="m-modal-title">{{selected.name}}</text><view class="m-redeem-points">{{selected.points}}<text>积分兑换</text></view><text class="m-modal-desc">{{selected.id==='coupon'?'满 200 元减 20 元，有效期 30 天。兑换后在结算页选择使用。':'确定性积分兑换。当前仅记录兑换，不真实发货。'}}</text><text class="m-note">可用积分 {{pointBalance}}，不支持现金购买积分。</text><button role="button" class="m-button m-wide" :disabled="busy" @click="redeem">确认积分兑换</button></template>
   <template v-else-if="modal==='pay'&&payOrder"><text class="m-eyebrow">TEST CHECKOUT / 不实际扣款</text><text class="m-modal-title">测试收银台</text><text class="m-pay-amount">¥{{money(payOrder.amount)}}</text><text class="m-modal-desc">这是模拟支付，不会唤起微信或支付宝，不产生真实扣款。测试付款后等待商家在运营后台登记发货，再由你确认收货。</text><view class="m-payment-method"><text>◉</text><text>内部测试支付</text><text>非真实商户支付</text></view><button role="button" class="m-button m-wide" :disabled="busy" @click="pay">确认测试付款（不扣款）</button></template>
   <template v-else-if="modal==='afterSale'&&payOrder"><text class="m-eyebrow">AFTER-SALES REQUEST</text><text class="m-modal-title">申请售后</text><text class="m-modal-desc">订单 {{payOrder.number}} · ¥{{money(payOrder.amount)}}。提交后由商家审核，不会立即退款。测试环境只回滚测试订单、库存与积分，不退还真实资金。</text><view class="m-form m-after-sale-form"><text>申请原因</text><textarea v-model="afterSaleReason" aria-label="售后申请原因" placeholder="请说明申请原因（至少 5 个字，不填写敏感信息）" maxlength="500"/><text class="m-muted">{{afterSaleReason.trim().length}} / 500 字。若已使用返还积分导致余额不足，商家需继续人工处理。</text></view><button role="button" class="m-button m-wide" :disabled="busy||afterSaleReason.trim().length<5" @click="submitAfterSale">提交售后申请</button></template>
   <template v-else-if="modal==='addresses'"><text class="m-modal-title">选择收货地址</text><text class="m-modal-desc">测试环境只填写虚构信息。</text><scroll-view scroll-y class="m-modal-scroll"><view v-for="a in addresses" :key="a.id" class="m-address-option" :class="{on:addressId===a.id}" @click="addressId=a.id;modal=''"><view class="m-grow"><text class="m-item-title">{{a.recipient}} {{a.phone}}</text><text class="m-muted">{{a.detail}}</text></view><text class="m-remove" @click.stop="removeAddress(a.id)">删除</text></view><view v-if="!addresses.length" class="m-empty">还没有收货地址</view></scroll-view><button role="button" class="m-button m-wide" @click="modal='addressForm'">＋ 新增测试地址</button></template>
   <template v-else-if="modal==='addressForm'"><text class="m-modal-title">新增测试地址</text><text class="m-modal-desc">请勿填写真实个人信息。</text><view class="m-form"><text>收货人</text><input v-model="recipient" placeholder="例如：测试用户" maxlength="30"/><text>手机号码</text><input v-model="phone" placeholder="例如：13800000000" maxlength="11" type="number"/><text>详细地址</text><textarea v-model="detail" placeholder="例如：测试省测试市演示路 1 号" maxlength="200"/></view><button role="button" class="m-button m-wide" :disabled="busy" @click="saveAddress">保存地址</button></template>
   <template v-else-if="modal==='ad'"><text class="m-eyebrow">内部演示 · 非真实广告</text><view class="m-ad-scene"><text>✳</text><text>好物与灵感，都值得多看一眼</text></view><text class="m-modal-title">完整体验后领取 30 积分</text><text class="m-modal-desc">提前关闭不奖励，演示记录 10 分钟内有效。真实广告平台尚未接入。</text><button role="button" class="m-button m-wide" :disabled="seconds>0||busy" :aria-disabled="seconds>0||busy" @click="claimAd">{{seconds?`体验中 · 剩余 ${seconds} 秒`:'领取 30 演示积分'}}</button></template>
   <template v-else-if="modal==='favorites'"><text class="m-modal-title">我的收藏</text><scroll-view scroll-y class="m-modal-scroll"><view v-if="!favorites.length" class="m-empty">还没有收藏商品</view><view v-for="p in catalog.filter(p=>favorites.includes(p.id))" :key="p.id" class="m-ledger-row" @click="openProduct(p)"><text class="m-grow">{{p.name}}</text><text class="m-orange">¥{{money(p.price)}} →</text></view></scroll-view></template>
   <template v-else><text class="m-modal-title">{{infoTitle}}</text><scroll-view scroll-y class="m-modal-scroll"><text class="m-info-body">{{infoBody}}</text></scroll-view><button role="button" class="m-button m-wide" @click="close">我知道了</button></template>
  </view></view>
  <view v-if="message" class="m-toast" role="status">{{message}}</view>
 </view>
</template>
