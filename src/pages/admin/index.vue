<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { request, idempotencyKey } from '../../lib/api'
import AdPlacement from '../../components/AdPlacement.vue'

type Product={id:string;name:string;subtitle:string;category:string;price:number;points:number;stock:number;art:string;color:string;badge:string}
const tabs=[{id:'admin',icon:'▦',label:'运营管理',en:'OPERATIONS'}]
const active=ref('home'),products=ref<Product[]>([]),user=ref<any>(null),ledger=ref<any[]>([]),orders=ref<any[]>([])
const query=ref(''),category=ref('全部好物'),sort=ref('推荐'),loading=ref(true),loadError=ref(''),busy=ref(false),toast=ref('')
const modal=ref(''),selected=ref<Product|null>(null),consent=ref(false),adsEnabled=ref(true),adminToken=ref(''),admin=ref<any>(null)
const ad=ref<any>(null),remaining=ref(0),claimPending=ref(false),favorites=ref<string[]>(uni.getStorageSync('aurora-favorites')||[])
const orderKey=ref(''),orderProduct=ref('')
const placements=ref<any[]>([])
let timer:ReturnType<typeof setInterval>|undefined,toastTimer:ReturnType<typeof setTimeout>|undefined
const categories=['全部好物','数码好物','生活美学','出行装备','专属权益']
const filtered=computed(()=>{
  let list=products.value.filter(p=>(category.value==='全部好物'||p.category===category.value)&&(!query.value||p.name.includes(query.value)||p.category.includes(query.value)))
  return sort.value==='积分优先'?[...list].sort((a,b)=>a.points-b.points):list
})
const balance=computed(()=>Number(user.value?.points||0).toLocaleString())
const earned=computed(()=>ledger.value.filter(x=>x.delta>0).reduce((n,x)=>n+x.delta,0))
const spent=computed(()=>-ledger.value.filter(x=>x.delta<0).reduce((n,x)=>n+x.delta,0))
const title=computed(()=>tabs.find(t=>t.id===active.value)?.label||'运营控制台')
function tell(message:string){toast.value=message;if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',3500)}
async function run(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;try{await fn()}catch(e:any){tell(e.message)}finally{busy.value=false}}
async function refresh(){
  const catalog=await request('/catalog');products.value=catalog.products;adsEnabled.value=catalog.adsEnabled;placements.value=catalog.placements||[]
  if(uni.getStorageSync('aurora-token')){
    try{user.value=await request('/me');const [l,o]=await Promise.all([request('/ledger'),request('/orders')]);ledger.value=l.items;orders.value=o.items}
    catch(e:any){if(e.status===401){user.value=null;ledger.value=[];orders.value=[]}else throw e}
  }
}
async function load(){loading.value=true;loadError.value='';try{await refresh()}catch(e:any){loadError.value=e.message}finally{loading.value=false}}
function go(id:string){active.value=id;query.value='';uni.pageScrollTo({scrollTop:0,duration:200})}
function requireUser(){if(user.value)return true;modal.value='login';return false}
async function login(){if(!consent.value){tell('请先阅读并同意体验说明与隐私说明');return}await run(async()=>{const r=await request('/auth/demo','POST',{consent:true});uni.setStorageSync('aurora-token',r.token);modal.value='';await refresh();tell('欢迎来到曜集，1,200 演示积分已到账')})}
async function checkin(){if(!requireUser())return;await run(async()=>{const r=await request('/checkin','POST',{});await refresh();tell(`签到成功，获得 ${r.reward} 积分`)})}
function viewProduct(p:Product){selected.value=p;modal.value='product'}
async function redeem(){if(!selected.value||!requireUser())return;const p=selected.value;await run(async()=>{
  if(orderProduct.value!==p.id||!orderKey.value){orderKey.value=idempotencyKey();orderProduct.value=p.id}
  await request('/orders','POST',{productId:p.id,requestKey:orderKey.value});orderKey.value='';orderProduct.value='';modal.value='';await refresh();tell('演示兑换成功，可在个人中心查看订单')
})}
function favorite(p:Product){favorites.value=favorites.value.includes(p.id)?favorites.value.filter(id=>id!==p.id):[...favorites.value,p.id];uni.setStorageSync('aurora-favorites',favorites.value);tell(favorites.value.includes(p.id)?'已加入心愿单':'已移出心愿单')}
async function startAd(){if(!requireUser())return;if(!adsEnabled.value){tell('激励体验暂时关闭');return}await run(async()=>{
  ad.value=await request('/ads/start','POST',{});remaining.value=ad.value.minimumSeconds;modal.value='ad';claimPending.value=false
  if(timer)clearInterval(timer);const end=Date.now()+remaining.value*1000
  timer=setInterval(()=>{remaining.value=Math.max(0,Math.ceil((end-Date.now())/1000));if(!remaining.value&&timer)clearInterval(timer)},250)
})}
async function claimAd(){if(remaining.value||claimPending.value||!ad.value)return;claimPending.value=true;await run(async()=>{
  await request('/ads/claim','POST',{sessionId:ad.value.id});modal.value='';await refresh();tell('30 演示积分已到账')
});claimPending.value=false}
function closeModal(){if(timer){clearInterval(timer);timer=undefined}modal.value=''}
function formatTime(time:number){return new Date(time).toLocaleString('zh-CN',{hour12:false})}
async function logout(){await run(async()=>{await request('/auth/logout','POST',{});uni.removeStorageSync('aurora-token');user.value=null;ledger.value=[];orders.value=[];tell('已退出体验账户')})}
async function openAdmin(){await run(async()=>{admin.value=await request('/admin/overview','GET',undefined,adminToken.value);admin.value.shopOrders=(await request('/admin/shop-orders','GET',undefined,adminToken.value)).items;active.value='admin';modal.value=''})}
async function toggleAds(){await run(async()=>{await request('/admin/settings','POST',{adsEnabled:!admin.value.adsEnabled},adminToken.value);admin.value=await request('/admin/overview','GET',undefined,adminToken.value);await refresh();tell('设置已保存，审计记录已生成')})}
async function togglePlacement(p:any){await run(async()=>{await request('/admin/placements','POST',{id:p.id,enabled:!p.enabled},adminToken.value);admin.value=await request('/admin/overview','GET',undefined,adminToken.value);await refresh();tell('广告占位配置已保存')})}
async function restrictUser(id:string,blocked:boolean){await run(async()=>{await request('/admin/restrictions','POST',{userId:id,blocked,reason:blocked?'运营人工复核后限制奖励':'运营人工复核后解除限制'},adminToken.value);admin.value=await request('/admin/overview','GET',undefined,adminToken.value);tell(blocked?'已限制该账户奖励与兑换':'已解除账户限制')})}
onMounted(()=>{active.value='admin';modal.value='admin';load()})
onUnmounted(()=>{if(timer)clearInterval(timer);if(toastTimer)clearTimeout(toastTimer)})
</script>

<template>
  <view class="app-shell">
    <view class="sidebar">
      <view class="brand" @click="go('home')"><view class="brand-mark">✳</view><view><text class="brand-name">曜集</text><text class="brand-en">A U R O R A</text></view></view>
      <view class="side-section">YOUR EVERYDAY, ELEVATED</view>
      <view class="nav-list"><view v-for="tab in tabs" :key="tab.id" class="nav-item" :class="{selected:active===tab.id}" @click="go(tab.id)"><text class="nav-icon">{{tab.icon}}</text><text>{{tab.label}}</text><text v-if="tab.id==='tasks'" class="nav-new">NEW</text><text v-if="active===tab.id" class="nav-dot">●</text></view></view>
      <view class="side-invite" @click="go('tasks')"><text class="tiny-label">A LITTLE EVERY DAY</text><text class="side-invite-title">小小积分<br/>兑换生活的惊喜</text><view class="invite-orb">✧</view><text class="side-invite-link">探索积分任务 ↗</text></view>
      <view class="side-bottom"><view class="status-dot"/><text>演示环境 · 安全体验</text></view>
      <view class="admin-entry" @click="modal='admin'">运营管理 ↗</view>
    </view>

    <view class="workspace">
      <view class="topbar">
        <view class="breadcrumb">曜集生活 <text class="slash">/</text> <text class="crumb-active">{{title}}</text></view>
        <view class="topbar-right"><view class="search-box"><text>⌕</text><input v-model="query" placeholder="搜索你的下一份心动" @confirm="active='shop'"/><text class="search-key" @click="active='shop'">↵</text></view><view class="notification" @click="modal='notice'">♧<text class="notification-dot"/></view><view class="avatar" @click="user?go('mine'):modal='login'">{{user?'曜':'访'}}</view></view>
      </view>

      <view class="content">
        <view v-if="loading" class="empty-state"><view class="loader"/><text>正在打开你的美好日常…</text></view>
        <view v-else-if="loadError" class="empty-state"><text class="empty-icon">⌁</text><text>暂时无法连接服务</text><text class="muted">{{loadError}}</text><button role="button" tabindex="0" class="primary" @click="load">重新连接</button></view>
        <template v-else>
          <view class="page-heading"><view><text class="eyebrow">{{active==='home'?'DISCOVER SOMETHING GOOD':active==='tasks'?'SMALL STEPS. MORE POSSIBILITIES.':active==='wallet'?'EVERY POINT HAS A STORY':'CURATED FOR YOUR EVERYDAY'}}</text><text class="page-title">{{active==='home'?'让日常，多一点惊喜':title}}<text class="title-spark">✦</text></text><text class="page-subtitle">{{active==='home'?'认真生活的你，值得每一份美好回响。':'把每一份热爱，变成看得见的美好。'}}</text></view><view class="date-chip">◷ <text>美好正在发生</text></view></view>

          <template v-if="active==='home'">
            <view class="hero-row">
              <view class="hero-banner"><view class="hero-grid"/><view class="hero-copy"><view class="hero-tag"><text class="green-dot"/> AURORA SELECT · 灵感生活季</view><text class="hero-title">热爱生活<br/>好礼自有回响<text class="hero-star">✧</text></text><text class="hero-description">发现心动好物，用积分收藏日常的小确幸。</text><button role="button" tabindex="0" class="hero-button" @click="go('shop')">探索精选好物 <text>↗</text></button><view class="hero-footnote"><text class="mini-avatar">A</text><text class="mini-avatar a2">U</text><text class="mini-avatar a3">R</text><text>为认真生活的你而选</text></view></view><image class="hero-art" src="/static/hero.svg" mode="aspectFit"/><text class="hero-watermark">GOOD THINGS<br/>TAKE A LITTLE SPARK.</text></view>
              <view class="points-card"><view class="card-top"><text>我的可用积分</text><text class="gold-icon">✦</text></view><view class="balance">{{balance}}<text>POINTS</text></view><view class="points-caption">{{user?'每一分积累，都值得期待':'开启体验，即领 1,200 演示积分'}}</view><view class="points-divider"/><view class="checkin-mini"><view><text class="checkin-title">{{user?.checkedIn?'今日已签到':'每日签到'}}</text><text class="muted">{{user?.streak?`已连续签到 ${user.streak} 天`:'每天一点，惊喜多一点'}}</text></view><button role="button" tabindex="0" class="small-gold" :aria-disabled="busy||user?.checkedIn" :disabled="busy||user?.checkedIn" @click="checkin">{{user?.checkedIn?'已领取':'签到 +20'}}</button></view><view class="week-dots"><view v-for="d in 7" :key="d" :class="{done:d<=(user?.streak||0)%7||user?.streak===7}"><text>{{d===7?'♢':'✧'}}</text><text>{{d===7?'+100':'+20'}}</text></view></view></view>
            </view>
            <view class="quick-links"><view @click="go('tasks')"><text class="quick-icon mint">✧</text><view><text class="quick-title">轻松赚积分</text><text class="muted">小任务，大惊喜</text></view><text class="quick-arrow">↗</text></view><view @click="go('shop');category='专属权益'"><text class="quick-icon peach">▱</text><view><text class="quick-title">会员专属礼</text><text class="muted">心意好券，积分兑换</text></view><text class="quick-arrow">↗</text></view><view @click="go('wallet')"><text class="quick-icon lavender">◈</text><view><text class="quick-title">每一分都算数</text><text class="muted">积分收支，清晰可见</text></view><text class="quick-arrow">↗</text></view></view>
          </template>

          <template v-if="active==='home'||active==='shop'">
            <view class="section-heading"><view><text class="section-title">{{active==='home'?'精选好物':'发现你的心动清单'}}</text><text class="section-description">GOOD FINDS, GOOD VIBES</text></view><view class="text-link" @click="active==='home'?go('shop'):sort=sort==='推荐'?'积分优先':'推荐'">{{active==='home'?'全部好物':sort}} <text>↗</text></view></view>
            <view class="filter-row"><view class="categories"><view v-for="c in categories" :key="c" :class="{chosen:category===c}" @click="category=c">{{c}}</view></view><text class="results-count">{{filtered.length}} 件精选</text></view>
            <view v-if="!filtered.length" class="empty-state"><text>还没有找到这份心动</text><button role="button" tabindex="0" class="secondary" @click="query='';category='全部好物'">查看全部好物</button></view>
            <view class="product-grid"><view v-for="p in active==='home'?filtered.slice(0,4):filtered" :key="p.id" class="product-card"><view class="product-visual" :style="{'--product-color':p.color}" @click="viewProduct(p)"><text class="product-badge">{{p.badge}}</text><view class="favorite" :class="{hearted:favorites.includes(p.id)}" @click.stop="favorite(p)">{{favorites.includes(p.id)?'♥':'♡'}}</view><view class="product-halo"/><image :src="`/static/${p.art}.svg`" class="product-image" mode="aspectFit"/><text class="product-art-label">AURORA / {{p.art.toUpperCase()}}</text></view><view class="product-info" @click="viewProduct(p)"><text class="product-category">{{p.category}}</text><text class="product-name">{{p.name}}</text><text class="product-subtitle">{{p.subtitle}}</text><view class="product-bottom"><view><text class="product-points">{{p.points.toLocaleString()}}</text><text class="points-unit"> 积分</text><text v-if="p.price" class="retail">参考 ¥{{p.price/100}}</text></view><view class="product-add">↗</view></view></view></view></view>
            <view class="editorial-banner" @click="go('tasks')"><view><text class="tiny-label">MAKE EVERY DAY COUNT</text><text class="editorial-title">把平凡日常，过成自己的收藏。</text></view><text class="editorial-right">从今天的小任务开始 <text>↗</text></text></view>
          </template>

          <template v-if="active==='tasks'">
            <view class="task-hero"><view><text class="eyebrow">YOUR DAILY RITUAL</text><text class="section-title">好习惯，也有好回报</text><text class="muted">签到积累积分，第 7 个连续签到日奖励 100 积分。</text></view><text class="task-hero-art">✳</text></view>
            <view class="task-layout"><view class="panel"><view class="section-heading"><text class="section-title">每日签到</text><text class="mint-text">连续 {{user?.streak||0}} 天</text></view><view class="checkin-days"><view v-for="d in 7" :key="d" :class="{current:d===((user?.streak||0)%7)+1}"><text>DAY {{d}}</text><text class="day-symbol">{{d===7?'♢':'✦'}}</text><text>+{{d===7?100:20}}</text></view></view><button role="button" tabindex="0" class="primary wide" :aria-disabled="busy||user?.checkedIn" :disabled="busy||user?.checkedIn" @click="checkin">{{user?.checkedIn?'今日已签到 · 明天见':'签到领取积分'}}</button></view><view class="panel task-notes"><text class="section-title">每一分，安心积累</text><text>01 · 积分仅用于站内确定性兑换</text><text>02 · 不支持充值、提现或转让</text><text>03 · 异常行为会触发风控审核</text><view class="soft-label">当前均为演示积分，不具现金价值</view></view></view>
            <view class="section-heading"><text class="section-title">今日任务</text><text class="muted">按自己的节奏，慢慢积累</text></view>
            <view class="task-list"><view class="task-item"><text class="task-icon mint">▷</text><view class="task-detail"><text class="task-name">探索品牌灵感 <text class="demo-label">广告演示</text></text><text class="muted">完成 8 秒内部演示 · 今日 {{user?.adCount||0}} / 5 次 · 间隔 30 秒</text></view><text class="reward-number">+30 <text>积分</text></text><button role="button" tabindex="0" class="secondary" :disabled="busy||!adsEnabled||(user?.adCount||0)>=5" @click="startAd">{{!adsEnabled?'暂时关闭':(user?.adCount||0)>=5?'已完成':'去体验 ↗'}}</button></view><view class="task-item"><text class="task-icon peach">♧</text><view class="task-detail"><text class="task-name">与朋友分享好物</text><text class="muted">支持系统分享或生成链接，不设置朋友圈奖励</text></view><text class="soft-label">自由分享 · 无积分奖励</text><button role="button" tabindex="0" class="secondary" @click="modal='share'">分享指引</button></view></view>
            <view class="integration-note"><text>◇</text><text>真实激励广告尚未接入。穿山甲及微信广告需分别完成平台审核，当前演示不产生广告收益。</text></view>
          </template>

          <template v-if="active==='wallet'">
            <view class="wallet-summary"><view class="wallet-main"><text>我的积分资产</text><view class="wallet-value">{{balance}}<text>POINTS</text></view><text class="muted">确定性兑换，让每份积累都有回响</text></view><view><text class="muted">已加载记录收入</text><text class="summary-number mint-text">+{{earned.toLocaleString()}}</text></view><view><text class="muted">已加载记录支出</text><text class="summary-number">{{spent.toLocaleString()}}</text></view><button role="button" tabindex="0" class="primary" @click="go('shop')">兑换好物 ↗</button></view>
            <view class="panel"><view class="section-heading"><text class="section-title">积分明细</text><text class="muted">最近 100 条记录</text></view><view v-if="!user" class="empty-state"><text>登录后查看每一分的故事</text><button role="button" tabindex="0" class="primary" @click="modal='login'">开启体验</button></view><view v-else-if="!ledger.length" class="empty-state">还没有积分记录</view><view v-for="entry in ledger" :key="entry.id" class="ledger-row"><text class="ledger-icon">{{entry.delta>0?'↙':'↗'}}</text><view class="grow"><text class="item-title">{{entry.label}}</text><text class="muted">{{formatTime(entry.created_at)}}</text></view><text class="ledger-value" :class="{'mint-text':entry.delta>0}">{{entry.delta>0?'+':''}}{{entry.delta}}</text></view></view>
          </template>

          <template v-if="active==='mine'">
            <view class="profile-card"><view class="profile-avatar">曜</view><view class="grow"><text class="section-title">{{user?.name||'你好，未来的曜集体验官'}}</text><text class="muted">{{user?'AURORA MEMBER · 演示会员':'一份新朋友见面礼，正在等你'}}</text></view><button role="button" tabindex="0" class="secondary" @click="user?logout():modal='login'">{{user?'退出登录':'开启体验 ↗'}}</button></view>
            <view class="profile-stats"><view @click="go('wallet')"><text>{{balance}}</text><text class="muted">可用积分 ↗</text></view><view @click="modal='orders'"><text>{{orders.length}}</text><text class="muted">演示订单 ↗</text></view><view @click="modal='favorites'"><text>{{favorites.length}}</text><text class="muted">我的心愿单 ↗</text></view></view>
            <view class="section-heading"><text class="section-title">我的兑换</text><text class="soft-label">演示订单不发货、不产生真实交易</text></view><view class="panel"><view v-if="!orders.length" class="empty-state"><text class="empty-icon">▱</text><text>把第一份心动带回家</text><button role="button" tabindex="0" class="secondary" @click="go('shop')">去发现好物 ↗</button></view><view v-for="o in orders" :key="o.id" class="order-row"><image :src="`/static/${products.find(p=>p.id===o.product_id)?.art||'coupon'}.svg`" mode="aspectFit"/><view class="grow"><text class="item-title">{{o.name}}</text><text class="muted">{{formatTime(o.created_at)}}</text><text class="order-id">{{o.id}}</text></view><view class="order-end"><text class="soft-label">演示兑换已记录</text><text>{{o.points}} 积分</text></view></view></view>
            <view class="settings-links"><view @click="modal='privacy'">隐私与数据说明 <text>↗</text></view><view @click="modal='rules'">积分使用规则 <text>↗</text></view><view @click="modal='help'">帮助与反馈 <text>↗</text></view><view @click="modal='admin'">运营控制台 <text>↗</text></view></view>
          </template>

          <template v-if="active==='admin'&&admin">
            <view class="integration-note">仅供内部运营 · 凭证只保存在当前页面内存中 · 演示环境无真实营收</view><view class="admin-stats"><view v-for="s in [{label:'体验账户',value:admin.stats.users},{label:'演示兑换',value:admin.stats.orders},{label:'累计发放积分',value:admin.stats.issued},{label:'有效演示观看',value:admin.stats.adViews}]" :key="s.label" class="panel"><text class="muted">{{s.label}}</text><text class="summary-number">{{s.value}}</text></view></view><view class="panel"><view class="section-heading"><text class="section-title">激励广告管理</text><button role="button" tabindex="0" class="secondary" :aria-disabled="busy" :disabled="busy" @click="toggleAds">{{admin.adsEnabled?'关闭':'开启'}}激励演示</button></view><view v-for="i in admin.integrations" :key="i.name" class="ledger-row"><text class="grow">{{i.name}}</text><text class="soft-label">{{i.status}}</text></view></view><view class="panel admin-panel"><text class="section-title">风控拦截记录</text><view v-if="!admin.risks.length" class="empty-state">暂无拦截记录</view><view v-for="r in admin.risks" :key="r.id" class="ledger-row"><view class="grow"><text class="item-title">{{r.action}} · {{r.reason}}</text><text class="muted">{{formatTime(r.created_at)}}</text></view><text class="risk-label">已拦截</text></view></view><view class="panel admin-panel"><text class="section-title">运营审计</text><view v-if="!admin.audits.length" class="empty-state">暂无配置变更</view><view v-for="a in admin.audits" :key="a.id" class="ledger-row"><text class="grow">{{a.action}} · {{a.detail}}</text><text class="muted">{{formatTime(a.created_at)}}</text></view></view>
          </template>
          <AdPlacement v-for="p in placements.filter(p=>p.position===active)" :key="p.id" :name="p.name" :format="p.format" @explore="startAd"/>
          <view v-if="active==='admin'&&admin" class="panel admin-panel"><text class="section-title">购物订单</text><view v-if="!admin.shopOrders?.length" class="empty-state">暂无购物订单</view><view v-for="o in admin.shopOrders" :key="o.id" class="ledger-row"><view class="grow"><text class="item-title">{{o.number}} · ¥{{(o.amount/100).toFixed(2)}}</text><text class="muted">{{o.items.map((i:any)=>i.name+' × '+i.quantity).join(' / ')}}</text></view><text class="soft-label">{{({pending:'待付款',paid:'待发货',shipped:'待收货',completed:'已完成',cancelled:'已取消',refunded:'已退款'} as any)[o.status]}} · 返 {{o.reward}} 积分</text></view><text class="section-title admin-panel">广告位置管理</text><text class="muted">按页面控制占位预览，不会加载真实广告 SDK</text><view v-for="p in admin.placements" :key="p.id" class="ledger-row"><view class="grow"><text class="item-title">{{p.name}}</text><text class="muted">{{p.id}} · {{p.format}}</text></view><button role="button" class="secondary" :disabled="busy" @click="togglePlacement(p)">{{p.enabled?'关闭预览':'开启预览'}}</button></view><text class="section-title admin-panel">账户限制管理</text><view v-if="!admin.blockedUsers.length" class="muted">暂无受限账户</view><view v-for="u in admin.blockedUsers" :key="u.user_id" class="ledger-row"><view class="grow"><text class="order-id">{{u.user_id}}</text><text class="muted">{{u.reason}}</text></view><button role="button" class="secondary" :disabled="busy" @click="restrictUser(u.user_id,false)">解除限制</button></view><text class="section-title admin-panel">待人工复核事件</text><view v-for="r in admin.risks.filter((r:any)=>r.user_id).slice(0,10)" :key="r.id" class="ledger-row"><view class="grow"><text class="item-title">{{r.reason}}</text><text class="order-id">{{r.user_id}}</text></view><button role="button" class="secondary" :disabled="busy" @click="restrictUser(r.user_id,true)">限制奖励</button></view></view>
          <view class="footer"><view><text class="footer-brand">✳ AURORA</text><text>让日常更有回响</text></view><view><text @click="modal='rules'">积分规则</text><text @click="modal='privacy'">隐私说明</text><text class="footer-demo">原创体验版 · 无真实交易</text></view></view>
        </template>
      </view>
    </view>
    <view class="mobile-nav"><view v-for="t in tabs" :key="t.id" :class="{current:active===t.id}" @click="go(t.id)"><text>{{t.icon}}</text><text>{{t.id==='home'?'发现':t.id==='shop'?'好物':t.id==='tasks'?'任务':t.id==='wallet'?'积分':'我的'}}</text></view></view>

    <view v-if="modal" class="modal-mask" @click="closeModal"><view class="modal-card" :class="{'product-modal':modal==='product'}" @click.stop><view class="modal-close" @click="closeModal">×</view>
      <template v-if="modal==='login'"><view class="modal-brand">✳</view><text class="eyebrow">WELCOME TO AURORA</text><text class="modal-title">好生活，从这里开始</text><text class="modal-description">开启独立测试账户，购物积分在确认收货后入账。无需手机号登录。</text><view class="welcome-gift"><text>✦</text><text>1,200</text><text>新朋友见面礼 / 演示积分</text></view><view class="consent-row" @click="consent=!consent"><text class="checkbox" :class="{checked:consent}">{{consent?'✓':''}}</text><text>我同意演示积分无现金价值、不发货的体验说明，并已阅读</text><text class="mint-text" @click.stop="modal='privacy'">隐私说明</text></view><button role="button" tabindex="0" class="primary wide" :aria-disabled="busy" :disabled="busy" @click="login">{{busy?'正在开启…':'同意并开启体验 ↗'}}</button></template>
      <template v-else-if="modal==='product'&&selected"><view class="detail-visual" :style="{background:`linear-gradient(135deg,${selected.color}25,#19202d)`}"><image :src="`/static/${selected.art}.svg`" mode="aspectFit"/></view><text class="eyebrow">{{selected.category}} · AURORA SELECT</text><text class="modal-title">{{selected.name}}</text><text class="modal-description">{{selected.subtitle}}</text><view class="detail-price"><text>{{selected.points.toLocaleString()}} <text class="points-unit">积分</text></text><text class="muted">剩余 {{selected.stock}} 件</text></view><view class="detail-notice">当前为演示商品。兑换仅记录积分扣减和订单，不收款、不发货。商品插图为原创概念图。</view><AdPlacement v-for="p in placements.filter(p=>p.position==='product')" :key="p.id" :name="p.name" :format="p.format" @explore="startAd"/><button role="button" tabindex="0" class="primary wide" :aria-disabled="busy||!selected.stock" :disabled="busy||!selected.stock" @click="redeem">{{!selected.stock?'已兑完':busy?'正在兑换…':'确认演示兑换 ↗'}}</button></template>
      <template v-else-if="modal==='ad'"><view class="ad-badge">内部演示 · 非真实广告</view><view class="ad-scene"><text>✧</text><text>给生活，留一点想象。</text><text>AURORA DAILY INSPIRATION</text></view><text class="modal-title">一点灵感，一份回响</text><text class="modal-description">这是 8 秒交互演示，不调用穿山甲、不产生广告收入。提前关闭不发放奖励。</text><view class="ad-progress"><view :style="{width:`${(8-remaining)/8*100}%`}"/></view><button role="button" tabindex="0" class="primary wide" :disabled="remaining>0||busy||claimPending" @click="claimAd">{{remaining?`还需 ${remaining} 秒`:'领取 30 演示积分'}}</button></template>
      <template v-else-if="modal==='admin'"><text class="eyebrow">OPERATIONS CONSOLE</text><text class="modal-title">运营管理</text><text class="modal-description">输入服务端 ADMIN_TOKEN。凭证仅在内存中使用，不写入本地存储。</text><input v-model="adminToken" class="admin-input" password placeholder="运营访问凭证"/><button role="button" tabindex="0" class="primary wide" :aria-disabled="busy||!adminToken" :disabled="busy||!adminToken" @click="openAdmin">安全进入 ↗</button></template>
      <template v-else-if="modal==='favorites'"><text class="modal-title">我的心愿单</text><scroll-view scroll-y class="modal-scroll"><view v-if="!favorites.length" class="empty-state">还没有收藏，去发现心动好物吧</view><view v-for="p in products.filter(p=>favorites.includes(p.id))" :key="p.id" class="ledger-row" @click="viewProduct(p)"><text class="grow">{{p.name}}</text><text class="mint-text">{{p.points}} 积分 ↗</text></view></scroll-view></template>
      <template v-else-if="modal==='orders'"><text class="modal-title">我的演示订单</text><text class="modal-description">已创建 {{orders.length}} 笔演示兑换，未产生真实交易。</text><button role="button" tabindex="0" class="primary wide" @click="modal='';go('mine')">查看全部订单 ↗</button></template>
      <template v-else><text class="eyebrow">AURORA / INFORMATION</text><text class="modal-title">{{modal==='privacy'?'隐私与数据说明':modal==='rules'?'积分规则':modal==='share'?'把好物分享给朋友':modal==='notice'?'曜集消息':'帮助与反馈'}}</text><scroll-view scroll-y class="modal-scroll"><view class="info-copy" v-if="modal==='privacy'"><text>当前版本收集：随机演示账户标识、会话凭证、签到记录、积分流水、演示订单及风控事件；心愿单保存在设备本地。服务器不收集手机号或支付信息。</text><text>会话凭证仅以哈希存储在服务器；客户端持有登录凭证，请勿在公共设备上长期登录。退出会撤销当前会话，但不会删除已生成的业务记录。</text><text>尚未接入穿山甲、数美或其他第三方采集 SDK。正式接入前需补充运营主体、数据保留期限、权限用途、第三方清单、注销与数据权利通道，并取得所需同意。</text><text>本页面是开发阶段的数据说明，不替代正式上线隐私政策。请勿在演示环境输入真实敏感信息。</text></view><view v-else-if="modal==='rules'" class="info-copy"><text>1. 当前积分均为演示积分，不具有现金价值，不支持购买、转让、提现或随机抽奖。</text><text>2. 首次开启体验获得 1,200 积分；普通签到 20 积分，每连续 7 天的第 7 天奖励 100 积分。</text><text>3. 内部广告体验每次奖励 30 积分，每日最多 5 次，两次开始间隔至少 30 秒。未完成或超时不奖励。</text><text>4. 积分按商品页面所示数量确定性兑换。演示兑换不收款、不发货。日期按北京时间计算。</text><text>5. 自动刷取、重复领奖和高频兑换会被拒绝。正式上线前另行制定完整运营规则、审核与申诉流程。</text></view><view v-else-if="modal==='share'" class="info-copy"><text>微信小程序请使用右上角菜单分享页面；App、H5 可通过系统或浏览器分享功能分享链接。</text><text>本版本不因分享到朋友圈发积分，也不检测或收集朋友圈内容。真实分享卡片与正式链接需要发布后配置。</text></view><view v-else-if="modal==='notice'" class="info-copy"><text>欢迎来到曜集原创体验版。</text><text>商城、签到、积分流水和演示兑换已开放。真实广告、支付、第三方风控及物流尚未接入。</text><text>所有数据均为开发体验用途，请勿用于真实交易。</text></view><view v-else class="info-copy"><text>遇到连接问题时，请确认 API 服务正在运行。设备端需配置可访问的 API 地址；小程序正式版要求已备案的 HTTPS 合法域名。</text><text>当前不提供真实客服或自动申诉入口。开发问题请通过项目维护渠道反馈，请勿发送账号凭证和密钥。</text></view></scroll-view><button role="button" tabindex="0" class="secondary wide" @click="closeModal">我知道了</button></template>
    </view></view>
    <view v-if="toast" class="toast" role="status">{{toast}}</view>
  </view>
</template>
