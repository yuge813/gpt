<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { request } from '../../lib/api'

const sections=[{id:'overview',icon:'◈',label:'运营总览'},{id:'products',icon:'▦',label:'商品管理'},{id:'orders',icon:'▤',label:'购物订单'},{id:'afterSales',icon:'↶',label:'售后审核'},{id:'rules',icon:'◇',label:'积分规则'},{id:'ads',icon:'▷',label:'广告管理'},{id:'risk',icon:'⌾',label:'风控与审计'}]
const section=ref('overview'),token=ref(''),authenticated=ref(false),busy=ref(false),loading=ref(false),error=ref(''),toast=ref(''),modal=ref('')
const overview=ref<any>(null),products=ref<any[]>([]),orders=ref<any[]>([]),afterSales=ref<any[]>([]),rules=ref({purchasePointsPerYuan:1}),ruleValue=ref('1')
const search=ref(''),orderFilter=ref('全部'),reviewFilter=ref('pending'),activeOrder=ref<any>(null),activeReview=ref<any>(null),reviewDecision=ref<'approve'|'reject'>('approve'),reviewNote=ref(''),carrier=ref(''),tracking=ref(''),showAddress=ref('')
const restrictionId=ref(''),restrictionReason=ref(''),restrictionBlocked=ref(true)
const exporting=ref(false)
let exportController:AbortController|undefined
const arts=['headphones','lamp','speaker','cup','bag','mouse','coupon']
const categories=['数码好物','生活美学','出行装备','专属权益']
const form=ref({id:'',version:0,name:'',subtitle:'',category:'数码好物',price:'',points:'',stock:'',art:'headphones',badge:'精选好物',enabled:true})
let timer:ReturnType<typeof setTimeout>|undefined
const statusNames:Record<string,string>={pending:'待付款',paid:'待发货',shipped:'待收货',completed:'已完成',cancelled:'已取消',refunded:'已退款'}
const reviewNames:Record<string,string>={pending:'待审核',approved:'已批准',rejected:'已拒绝'}
const filteredProducts=computed(()=>products.value.filter(p=>!search.value||p.name.includes(search.value)||p.category.includes(search.value)))
const filteredOrders=computed(()=>orders.value.filter(o=>orderFilter.value==='全部'||statusNames[o.status]===orderFilter.value))
const filteredReviews=computed(()=>afterSales.value.filter(a=>reviewFilter.value==='all'||a.status===reviewFilter.value))
const title=computed(()=>sections.find(s=>s.id===section.value)?.label||'运营总览')
const pendingReviewCount=computed(()=>afterSales.value.filter(a=>a.status==='pending').length)
const money=(n:number)=>(n/100).toFixed(2)
const date=(n:number)=>new Date(n).toLocaleString('zh-CN',{hour12:false})
const productPhoto=(art:string)=>`/static/${art}.${art==='coupon'?'svg':'jpg'}`
function notify(text:string){toast.value=text;if(timer)clearTimeout(timer);timer=setTimeout(()=>toast.value='',4500)}
function back(){uni.reLaunch({url:'/pages/index/index'})}
function navigate(id:string){section.value=id;search.value='';uni.pageScrollTo({scrollTop:0,duration:100})}
async function api(path:string,method:'GET'|'POST'='GET',data?:Record<string,unknown>){return request(path,method,data,token.value)}
async function loadData(){
 loading.value=true;error.value=''
 try{
  const [o,p,so,a,r]=await Promise.all([api('/admin/overview'),api('/admin/products'),api('/admin/shop-orders'),api('/admin/after-sales'),api('/admin/points-rules')])
  overview.value=o;products.value=p.items;orders.value=so.items;afterSales.value=a.items;rules.value=r;ruleValue.value=String(r.purchasePointsPerYuan)
 }catch(e:any){error.value=e.message;throw e}finally{loading.value=false}
}
async function login(){
 if(busy.value||!token.value.trim())return;busy.value=true;error.value=''
 try{token.value=token.value.trim();overview.value=await api('/admin/overview');authenticated.value=true;await loadData();notify('已进入运营控制台')}
 catch(e:any){error.value=e.message;if(e.status===401||e.status===403)authenticated.value=false}
 finally{busy.value=false}
}
function logout(){exportController?.abort();token.value='';authenticated.value=false;overview.value=null;products.value=[];orders.value=[];afterSales.value=[];modal.value='';error.value='';notify('运营凭证已从页面内存清除')}
async function run(fn:()=>Promise<void>,success='操作已保存'){
 if(busy.value)return;busy.value=true;error.value=''
 try{await fn();modal.value='';try{await loadData();notify(success)}catch(e:any){error.value=e.message;notify(`${success}；但列表刷新失败，请点击刷新数据。`)}}catch(e:any){error.value=e.message;notify(e.status===409?`${e.message}。请刷新后重试；库存或订单未强行覆盖。`:e.message)}finally{busy.value=false}
}
async function reload(){if(busy.value)return;try{await loadData();notify('数据已刷新')}catch{}}
async function exportOrders(){
 // #ifndef H5
 notify('请在浏览器打开运营后台下载 CSV 文件')
 return
 // #endif
 // #ifdef H5
 if(exporting.value||!authenticated.value)return
 exporting.value=true;error.value=''
 const controller=new AbortController();exportController=controller
 const timeout=setTimeout(()=>controller.abort(),30000)
 try{
  const base=(import.meta.env.VITE_API_BASE as string|undefined)||'/api'
  const response=await fetch(`${base.replace(/\/$/,'')}/admin/shop-orders/export.csv?limit=1000`,{headers:{'X-Admin-Token':token.value},credentials:'omit',signal:controller.signal})
  if(!response.ok){const result=await response.json().catch(()=>null);throw new Error(result?.message||`导出失败（${response.status}）`)}
  const blob=await response.blob()
  if(!authenticated.value||controller.signal.aborted)return
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download=`aurora-orders-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(link)
  try{link.click()}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  notify('已请求下载最近最多 1000 笔订单，文件不含收货地址和手机号')
 }catch(e:any){if(authenticated.value){error.value=e.name==='AbortError'?'导出已中断或超时，请重试':e.message}}
 finally{clearTimeout(timeout);exporting.value=false;if(exportController===controller)exportController=undefined}
 // #endif
}
function openProduct(p?:any){
 form.value=p?{id:p.id,version:p.version,name:p.name,subtitle:p.subtitle,category:p.category,price:money(p.price),points:String(p.points),stock:String(p.stock),art:p.art,badge:p.badge,enabled:!!p.enabled}:{id:'',version:0,name:'',subtitle:'',category:'数码好物',price:'',points:'',stock:'',art:'headphones',badge:'精选好物',enabled:true}
 modal.value='product'
}
async function saveProduct(){
 if(!form.value.name.trim()||!form.value.subtitle.trim()){notify('请填写商品名称和简介');return}
 if(!/^\d+(\.\d{1,2})?$/.test(form.value.price)||!/^\d+$/.test(form.value.points)||!/^\d+$/.test(form.value.stock)){notify('请填写正确的金额、整数兑换积分和整数库存');return}
 const f=form.value
 await run(()=>api('/admin/products/save','POST',{id:f.id,version:f.version,name:f.name.trim(),subtitle:f.subtitle.trim(),category:f.category,price:Math.round(Number(f.price)*100),points:Number(f.points),stock:Number(f.stock),art:f.art,badge:f.badge.trim(),enabled:f.enabled}).then(()=>{}),'商品已保存，前台将按上架状态显示')
}
function openShipping(o:any){activeOrder.value=o;carrier.value=o.shipment?.carrier||'';tracking.value=o.shipment?.tracking||'';modal.value='ship'}
async function ship(){if(!carrier.value.trim()||!tracking.value.trim()){notify('请填写承运商和物流单号');return}await run(()=>api(`/admin/shop-orders/${activeOrder.value.id}/ship`,'POST',{carrier:carrier.value.trim(),tracking:tracking.value.trim()}).then(()=>{}),'发货记录已保存；未调用第三方物流服务')}
function openReview(a:any,decision:'approve'|'reject'){activeReview.value=a;reviewDecision.value=decision;reviewNote.value='';modal.value='review'}
async function resolveReview(){if(reviewNote.value.trim().length<3){notify('审核意见至少填写 3 个字符');return}await run(()=>api(`/admin/after-sales/${activeReview.value.id}/resolve`,'POST',{decision:reviewDecision.value,note:reviewNote.value.trim()}).then(()=>{}),reviewDecision.value==='approve'?'测试退款已审核完成，库存与积分同步处理':'售后申请已拒绝并记录审核意见')}
async function saveRules(){if(!/^\d+$/.test(ruleValue.value)||Number(ruleValue.value)>10){notify('购物倍率应为 0 到 10 的整数');return}await run(()=>api('/admin/points-rules','POST',{purchasePointsPerYuan:Number(ruleValue.value)}).then(()=>{}),'积分规则已保存，仅影响之后创建的订单')}
async function toggleAds(){await run(()=>api('/admin/settings','POST',{adsEnabled:!overview.value.adsEnabled}).then(()=>{}),'激励体验开关已保存')}
async function togglePlacement(p:any){await run(()=>api('/admin/placements','POST',{id:p.id,enabled:!p.enabled}).then(()=>{}),'广告位置预览配置已保存')}
async function restrict(userId:string,blocked:boolean,reason:string){if(reason.trim().length<3){notify('请填写至少 3 个字符的操作原因');return}await run(()=>api('/admin/restrictions','POST',{userId,blocked,reason:reason.trim()}).then(()=>{}),blocked?'账户奖励与兑换已限制':'账户奖励限制已解除')}
async function submitRestriction(){await restrict(restrictionId.value.trim(),restrictionBlocked.value,restrictionReason.value)}
onUnmounted(()=>{exportController?.abort();token.value='';if(timer)clearTimeout(timer)})
</script>

<template>
 <view class="ops">
  <view v-if="!authenticated" class="ops-login-shell">
   <view class="ops-login-aside"><text class="ops-logo">曜集 / MERCHANT</text><view><text class="ops-login-eyebrow">A CLEARER WAY TO OPERATE</text><text class="ops-login-heading">每一笔生意<text class="ops-line-break">
</text>都清楚有据。</text><text class="ops-login-sub">商品、订单、积分与售后，在一个控制台协同。</text></view><text class="ops-login-foot">独立运营入口 · 不保存你的访问凭证</text></view>
   <view class="ops-login-card"><text class="ops-kicker">OPERATIONS CONSOLE</text><text class="ops-h1">商家运营控制台</text><text class="ops-muted">输入服务端配置的 ADMIN_TOKEN。凭证仅用于当前页面会话，关闭或退出后清除。</text><text class="ops-field-label">运营访问凭证</text><input v-model="token" class="admin-input ops-login-input" password aria-label="运营访问凭证" placeholder="输入运营凭证" @confirm="login"/><view v-if="error" class="ops-error" role="alert">{{error}}</view><button role="button" class="ops-button ops-primary ops-wide" :aria-disabled="busy||!token.trim()" :disabled="busy||!token.trim()" @click="login">{{busy?'正在验证…':'安全进入'}}</button><view class="ops-login-warning">测试环境：真实支付、广告结算和数美服务均未接入。</view><button role="button" class="ops-button ops-link ops-wide" @click="back">← 返回商城</button></view>
  </view>
  <template v-else>
   <view class="ops-sidebar"><view class="ops-side-brand" @click="navigate('overview')"><view>曜</view><view><text>曜集商家</text><text>MERCHANT CONSOLE</text></view></view><text class="ops-side-caption">WORKSPACE / 运营空间</text><view class="ops-nav"><view v-for="s in sections" :key="s.id" :data-testid="'ops-nav-'+s.id" role="button" :class="{active:section===s.id}" @click="navigate(s.id)"><text>{{s.icon}}</text><text>{{s.label}}</text><text v-if="s.id==='afterSales'&&pendingReviewCount" class="ops-nav-count">{{pendingReviewCount}}</text></view></view><view class="ops-side-note"><text>TEST ENVIRONMENT</text><text>当前用于内部验收</text><text>不接收真实付款，不产生广告收入。</text></view><button role="button" class="ops-button ops-side-store" @click="back">返回商城 ↗</button></view>
   <view class="ops-workspace"><view class="ops-topbar"><view><text class="ops-muted">运营工作台 /</text><text>{{title}}</text></view><view><text class="ops-environment">● 测试环境</text><button role="button" class="ops-button ops-quiet" :aria-disabled="loading||busy" :disabled="loading||busy" @click="reload">{{loading?'刷新中…':'刷新数据'}}</button><button role="button" class="ops-button ops-quiet" @click="logout">退出</button></view></view>
    <view class="ops-content"><view class="ops-heading"><view><text class="ops-kicker">YAOJI / {{section.toUpperCase()}}</text><text class="ops-h1">{{title}}</text><text class="ops-muted">真实业务记录，清晰操作边界。变更保存后生成审计记录。</text></view><button v-if="section==='products'" role="button" class="ops-button ops-primary" @click="openProduct()">＋ 新建商品</button></view>
     <view v-if="error" class="ops-error" role="alert">{{error}}<text @click="reload">刷新重试 →</text></view>
     <view v-if="loading&&!overview" class="ops-empty">正在读取运营数据…</view>
     <template v-if="overview">
      <template v-if="section==='overview'">
       <view class="ops-metrics"><view v-for="m in [{label:'体验账户',value:overview.stats.users,unit:'个',hint:'独立测试账户'},{label:'测试订单',value:overview.stats.orders,unit:'笔',hint:'含购物与积分兑换'},{label:'累计发放积分',value:overview.stats.issued,unit:'分',hint:'按积分流水统计'},{label:'有效广告演示',value:overview.stats.adViews,unit:'次',hint:'内部演示，不计广告收益'}]" :key="m.label"><text>{{m.label}}</text><text>{{m.value.toLocaleString()}}<text>{{m.unit}}</text></text><text>{{m.hint}}</text></view></view>
       <view class="ops-overview-grid"><view class="ops-panel"><view class="ops-panel-heading"><text class="ops-h2">待处理事项</text><text class="ops-label">基于当前加载记录</text></view><view class="ops-action-row" @click="navigate('orders');orderFilter='待发货'"><view><text class="ops-item-title">待发货订单</text><text class="ops-muted">确认承运信息，记录商家发货</text></view><text>{{orders.filter(o=>o.status==='paid').length}} <text>→</text></text></view><view class="ops-action-row" @click="navigate('afterSales')"><view><text class="ops-item-title">待审核售后</text><text class="ops-muted">核对订单状态与积分回收条件</text></view><text>{{pendingReviewCount}} <text>→</text></text></view><view class="ops-action-row" @click="navigate('products')"><view><text class="ops-item-title">低库存商品</text><text class="ops-muted">可售库存不超过 5 件</text></view><text>{{products.filter(p=>p.enabled&&p.stock<=5).length}} <text>→</text></text></view></view><view class="ops-panel"><view class="ops-panel-heading"><text class="ops-h2">服务接入状态</text><text class="ops-label">如实展示</text></view><view v-for="i in overview.integrations" :key="i.name" class="ops-integration"><view class="ops-status-dot"/><view><text class="ops-item-title">{{i.name}}</text><text class="ops-muted">{{i.status}}</text></view></view><view class="ops-info">发货记录由商家手动录入，不代表物流平台已揽件；售后批准只执行测试账务，不退还真实资金。</view></view></view>
      </template>

      <template v-if="section==='products'">
       <view class="ops-toolbar"><view class="ops-search"><text>⌕</text><input v-model="search" aria-label="搜索商品" placeholder="按商品名或分类搜索"/></view><text class="ops-muted">{{filteredProducts.length}} 件商品 · 保存时校验版本，避免覆盖并发变更</text></view><view class="ops-product-grid"><view v-for="p in filteredProducts" :key="p.id" :data-product-id="p.id" class="ops-product-card"><view class="ops-product-image"><image :src="productPhoto(p.art)" mode="aspectFill"/><text :class="{off:!p.enabled}">{{p.enabled?'已上架':'已下架'}}</text></view><view class="ops-product-body"><text class="ops-muted">{{p.category}} · 版本 {{p.version}}</text><text class="ops-item-title">{{p.name}}</text><view class="ops-product-pricing"><text>¥{{money(p.price)}}</text><text>{{p.points}} 积分兑换</text></view><view class="ops-product-footer"><text>库存 <text :class="{'ops-danger-text':p.stock<=5}">{{p.stock}}</text></text><button role="button" class="ops-button ops-soft" @click="openProduct(p)">编辑商品</button></view></view></view></view><view v-if="!filteredProducts.length" class="ops-empty ops-panel">没有匹配的商品</view>
      </template>

      <template v-if="section==='orders'">
       <view class="ops-export-bar"><view><text class="ops-item-title">订单报表</text><text class="ops-muted">导出全部状态的最近最多 1000 笔测试订单，不含收货地址与手机号。请妥善保管文件。</text></view><button role="button" class="ops-button ops-outline" data-testid="ops-orders-export" :disabled="exporting||busy" :aria-disabled="exporting||busy" @click="exportOrders">{{exporting?'正在导出…':'导出最近订单 CSV'}}</button></view>
       <view class="ops-filters"><view v-for="s in ['全部','待付款','待发货','待收货','已完成','已退款','已取消']" :key="s" :class="{active:orderFilter===s}" @click="orderFilter=s">{{s}}</view></view><view v-if="!filteredOrders.length" class="ops-empty ops-panel">当前筛选下暂无购物订单</view><view v-for="o in filteredOrders" :key="o.id" class="ops-panel ops-order" :data-order-id="o.id"><view class="ops-order-heading"><view><text class="ops-item-title">{{o.number}}</text><text class="ops-muted">{{date(o.created_at)}} · 测试订单</text></view><text class="ops-status" :class="o.status">{{statusNames[o.status]||o.status}}</text></view><view v-for="p in o.items" :key="p.product_id" class="ops-order-item"><image :src="productPhoto(p.art)" mode="aspectFill"/><view><text class="ops-item-title">{{p.name}}</text><text class="ops-muted">¥{{money(p.price)}} × {{p.quantity}}</text></view><text>¥{{money(p.price*p.quantity)}}</text></view><view class="ops-order-meta"><view><text class="ops-muted">订单金额</text><text class="ops-amount">¥{{money(o.amount)}}</text></view><view><text class="ops-muted">购物返积分</text><text>{{o.reward}} 分</text></view><view v-if="o.shipment"><text class="ops-muted">发货记录</text><text>{{o.shipment.carrier}} · {{o.shipment.tracking}}</text></view><view v-if="o.afterSale"><text class="ops-muted">售后状态</text><text>{{reviewNames[o.afterSale.status]||o.afterSale.status}}</text></view></view><view v-if="showAddress===o.id" class="ops-address"><text>{{o.address?.recipient}} · {{o.address?.phone}}</text><text>{{o.address?.detail}}</text></view><view class="ops-order-actions"><button role="button" class="ops-button ops-quiet" @click="showAddress=showAddress===o.id?'':o.id">{{showAddress===o.id?'收起地址':'查看收货地址'}}</button><button v-if="o.status==='paid'" role="button" class="ops-button ops-primary" @click="openShipping(o)">录入发货</button><text v-else class="ops-muted">{{o.status==='shipped'?'等待客户确认收货':'按订单状态处理，不能跳过付款直接发货'}}</text></view></view>
      </template>

      <template v-if="section==='afterSales'">
       <view class="ops-filters"><view v-for="s in [{id:'pending',name:'待审核'},{id:'approved',name:'已批准'},{id:'rejected',name:'已拒绝'},{id:'all',name:'全部申请'}]" :key="s.id" :class="{active:reviewFilter===s.id}" @click="reviewFilter=s.id">{{s.name}}</view></view><view class="ops-info ops-section-gap">批准时同步恢复库存与可返还的优惠券，并回收已发放的购物积分。积分不足不会制造负余额，申请保持待审，需先解决账务差异。</view><view v-if="!filteredReviews.length" class="ops-empty ops-panel">暂无相关售后申请</view><view v-for="a in filteredReviews" :key="a.id" class="ops-panel ops-review-card" :data-review-id="a.id"><view class="ops-order-heading"><view><text class="ops-item-title">{{a.orderNumber}}</text><text class="ops-muted">{{date(a.created_at)}}</text></view><text class="ops-status" :class="a.status">{{reviewNames[a.status]||a.status}}</text></view><view class="ops-review-reason"><text class="ops-muted">客户申请原因</text><text>{{a.reason}}</text></view><view class="ops-order-meta"><view><text class="ops-muted">测试退款金额</text><text class="ops-amount">¥{{money(a.amount)}}</text></view><view><text class="ops-muted">相关购物积分</text><text>{{a.reward}} 分</text></view></view><view v-if="a.resolution" class="ops-review-resolution"><text class="ops-muted">审核意见</text><text>{{a.resolution}}</text></view><view v-if="a.status==='pending'" class="ops-review-actions"><button role="button" class="ops-button ops-outline" data-testid="ops-review-reject" @click="openReview(a,'reject')">拒绝申请</button><button role="button" class="ops-button ops-primary" data-testid="ops-review-approve" @click="openReview(a,'approve')">审核通过</button></view></view>
      </template>

      <template v-if="section==='rules'">
       <view class="ops-rules-layout"><view class="ops-panel"><text class="ops-h2">购物积分倍率</text><text class="ops-muted ops-section-gap">规则保存后只影响新创建的订单，已有订单使用下单时快照。</text><view class="ops-rule-equation"><text>实付每满 ¥1</text><text>→</text><view><input v-model="ruleValue" type="number" aria-label="每元购物积分" data-testid="ops-reward-rate" maxlength="2"/><text>积分</text></view></view><text class="ops-muted">允许 0–10 的整数。设为 0 表示新订单不返购物积分。</text><button role="button" class="ops-button ops-primary ops-section-gap" :aria-disabled="busy" :disabled="busy" data-testid="ops-reward-save" @click="saveRules">保存积分规则</button></view><view class="ops-panel"><text class="ops-h2">入账与回收原则</text><view class="ops-rule-step"><text>01</text><view><text>按优惠后实付计算</text><text class="ops-muted">以整数分计价，客户端不能指定积分。</text></view></view><view class="ops-rule-step"><text>02</text><view><text>确认收货后入账</text><text class="ops-muted">付款后仅显示待入账，避免重复发放。</text></view></view><view class="ops-rule-step"><text>03</text><view><text>售后退款同步回收</text><text class="ops-muted">不允许重复恢复库存或重复扣回积分。</text></view></view><view class="ops-info">签到和广告演示奖励目前使用固定规则。本页不会修改付费抽奖、积分提现或现金购买积分。</view></view></view>
      </template>

      <template v-if="section==='ads'">
       <view class="ops-panel ops-ad-control"><view><text class="ops-h2">激励广告管理</text><text class="ops-muted">只控制内部激励演示，不会启用真实广告 SDK。</text></view><button role="button" class="ops-button" :class="overview.adsEnabled?'ops-outline':'ops-primary'" :aria-disabled="busy" :disabled="busy" data-testid="ops-ad-toggle" @click="toggleAds">{{overview.adsEnabled?'关闭激励演示':'开启激励演示'}}</button></view><view class="ops-panel ops-section-gap"><view class="ops-panel-heading"><text class="ops-h2">广告位置管理</text><text class="ops-label">占位预览</text></view><view v-for="p in overview.placements" :key="p.id" class="ops-placement"><view><text class="ops-item-title">{{p.name}}</text><text class="ops-muted">{{p.id}} · {{p.format}}</text></view><text class="ops-label">{{p.enabled?'预览开启':'预览关闭'}}</text><button role="button" class="ops-button ops-soft" :aria-disabled="busy" :disabled="busy" @click="togglePlacement(p)">{{p.enabled?'关闭预览':'开启预览'}}</button></view></view><view class="ops-info ops-section-gap">穿山甲、微信广告需要分别完成账户、应用及广告位配置和审核。当前没有真实曝光、广告收入或平台结算。</view>
      </template>

      <template v-if="section==='risk'">
       <view class="ops-panel"><view class="ops-panel-heading"><text class="ops-h2">人工账户限制</text><text class="ops-label">仅本地规则，未接入数美</text></view><view class="ops-restriction-form"><input v-model="restrictionId" aria-label="限制账户 ID" placeholder="账户 UUID"/><input v-model="restrictionReason" aria-label="限制操作原因" placeholder="填写限制或解除原因"/><view class="ops-toggle" @click="restrictionBlocked=!restrictionBlocked"><text :class="{on:restrictionBlocked}">{{restrictionBlocked?'限制奖励与兑换':'解除奖励限制'}}</text><text>点击切换</text></view><button role="button" class="ops-button ops-primary" :aria-disabled="busy" :disabled="busy" @click="submitRestriction">执行并记录审计</button></view><view v-for="u in overview.blockedUsers" :key="u.user_id" class="ops-risk-row"><view><text class="ops-mono">{{u.user_id}}</text><text class="ops-muted">{{u.reason}}</text></view><button role="button" class="ops-button ops-outline" :aria-disabled="busy" :disabled="busy" @click="restrict(u.user_id,false,'运营人工复核后解除奖励限制')">解除限制</button></view></view><view class="ops-risk-grid"><view class="ops-panel"><text class="ops-h2">风控拦截记录</text><view v-if="!overview.risks.length" class="ops-empty">暂无拦截记录</view><view v-for="r in overview.risks" :key="r.id" class="ops-log-row"><view><text class="ops-item-title">{{r.action}} · {{r.reason}}</text><text class="ops-muted">{{date(r.created_at)}}</text><text class="ops-mono">{{r.user_id}}</text></view><text class="ops-status rejected">已拦截</text></view></view><view class="ops-panel"><text class="ops-h2">操作审计</text><view v-if="!overview.audits.length" class="ops-empty">暂无操作记录</view><view v-for="a in overview.audits" :key="a.id" class="ops-log-row"><view><text class="ops-item-title">{{a.action}}</text><text class="ops-muted">{{date(a.created_at)}}</text><text class="ops-log-detail">{{a.detail}}</text></view></view></view></view>
      </template>
     </template>
     <view class="ops-footer"><text>曜集商家工作台 · 内部验收版</text><text>业务变更有记录，第三方接入不冒充完成</text></view>
    </view>
   </view>
  </template>
  <view v-if="modal" class="ops-modal-mask" @click="modal=''"><view class="ops-modal" :class="{'ops-modal-large':modal==='product'}" @click.stop><view class="ops-modal-close" role="button" aria-label="关闭操作窗口" @click="modal=''">×</view>
   <template v-if="modal==='product'"><text class="ops-kicker">CATALOG EDITOR</text><text class="ops-h2">{{form.id?'编辑商品':'新建商品'}}</text><text class="ops-muted">金额以元输入，保存时转换为整数分；库存保存会验证数据版本。</text><view class="ops-product-form ops-form" data-testid="ops-product-form"><label><text>商品名称</text><input v-model="form.name" aria-label="商品名称" data-testid="ops-product-name" maxlength="80" placeholder="填写商品名称"/></label><label><text>商品简介</text><input v-model="form.subtitle" aria-label="商品简介" data-testid="ops-product-subtitle" maxlength="160" placeholder="简短介绍商品"/></label><view class="ops-form-grid"><label><text>分类</text><picker :range="categories" :value="categories.indexOf(form.category)" @change="form.category=categories[Number($event.detail.value)]"><view class="ops-picker">{{form.category}} <text>⌄</text></view></picker></label><label><text>图片素材</text><picker :range="arts" :value="arts.indexOf(form.art)" @change="form.art=arts[Number($event.detail.value)]"><view class="ops-picker">{{form.art}} <text>⌄</text></view></picker></label><label><text>售价（元）</text><input v-model="form.price" type="digit" aria-label="商品售价" data-testid="ops-product-price" placeholder="例如 99.00"/></label><label><text>兑换积分</text><input v-model="form.points" type="number" aria-label="商品兑换积分" data-testid="ops-product-points" placeholder="整数积分"/></label><label><text>可售库存</text><input v-model="form.stock" type="number" aria-label="商品库存" data-testid="ops-product-stock" placeholder="整数库存"/></label><label><text>展示标签</text><input v-model="form.badge" aria-label="商品标签" maxlength="20" placeholder="例如 精选好物"/></label></view><view class="ops-product-state"><view><text class="ops-item-title">商品上架状态</text><text class="ops-muted">下架后不允许新购买或新兑换。</text></view><button role="button" class="ops-button" :class="form.enabled?'ops-soft':'ops-outline'" @click="form.enabled=!form.enabled">{{form.enabled?'已上架 · 点击下架':'已下架 · 点击上架'}}</button></view><view class="ops-info">图片来自现有测试素材，不代表供应商品牌授权。选择券图不会自动发行购物券；目前只有内置 20 元购物券具有发券能力。正式上架前应替换为授权商品资料。</view><button role="button" class="ops-button ops-primary ops-wide" :aria-disabled="busy" :disabled="busy" data-testid="ops-product-save" @click="saveProduct">{{busy?'保存中…':'保存商品'}}</button></view></template>
   <template v-else-if="modal==='ship'&&activeOrder"><text class="ops-kicker">ORDER FULFILLMENT</text><text class="ops-h2">录入发货信息</text><text class="ops-muted">{{activeOrder.number}}</text><view class="ops-info">仅保存商家录入的物流记录，不调用真实物流 API，也不证明承运商已揽收。</view><view class="ops-shipping-form ops-form" data-testid="ops-shipping-form"><label><text>承运商</text><input v-model="carrier" aria-label="发货承运商" data-testid="ops-shipping-carrier" placeholder="例如：测试承运商" maxlength="40"/></label><label><text>物流单号</text><input v-model="tracking" aria-label="发货物流单号" data-testid="ops-shipping-tracking" placeholder="填写物流单号" maxlength="80"/></label><button role="button" class="ops-button ops-primary ops-wide" :aria-disabled="busy" :disabled="busy" data-testid="ops-shipping-save" @click="ship">保存发货记录</button></view></template>
   <template v-else-if="modal==='review'&&activeReview"><text class="ops-kicker">AFTER-SALES REVIEW</text><text class="ops-h2">{{reviewDecision==='approve'?'批准测试退款':'拒绝售后申请'}}</text><text class="ops-muted">{{activeReview.orderNumber}} · ¥{{money(activeReview.amount)}}</text><view class="ops-info">{{reviewDecision==='approve'?'批准会在同一事务内处理测试订单、库存、购物券和购物积分。若返积分已被使用且余额不足，操作将被拒绝，申请保持待审。':'拒绝后保留原订单及积分状态，审核意见会提供给客户。'}}</view><view class="ops-review-form ops-form"><label><text>审核意见</text><textarea v-model="reviewNote" aria-label="售后审核意见" data-testid="ops-review-note" placeholder="填写依据和处理说明，至少 3 字" maxlength="300"/></label><button role="button" class="ops-button ops-primary ops-wide" :aria-disabled="busy" :disabled="busy" data-testid="ops-review-submit" @click="resolveReview">{{reviewDecision==='approve'?'确认批准测试退款':'确认拒绝申请'}}</button></view></template>
  </view></view>
  <view v-if="toast" class="ops-toast" role="status">{{toast}}</view>
 </view>
</template>
<style src="../../admin.css"></style>
