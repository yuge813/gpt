<script setup lang="ts">
import type { ShopProduct } from '../lib/shop'
defineProps<{product:ShopProduct;pointsMode?:boolean}>()
defineEmits<{(event:'open',product:ShopProduct):void;(event:'add',product:ShopProduct):void}>()
</script>
<template>
  <view class="m-product" @click="$emit('open',product)">
    <view class="m-product-photo"><image :src="`/static/${product.art}.${product.art==='coupon'?'svg':'jpg'}`" mode="aspectFill"/><text class="m-product-tag">{{pointsMode?'积分兑好礼':product.badge}}</text></view>
    <view class="m-product-content"><text class="m-product-name">{{product.name}}</text><text class="m-product-desc">{{product.subtitle}}</text><view class="m-product-reward">{{pointsMode?'确定性兑换 · 无抽奖':`收货返 ${product.rewardPoints} 积分`}}</view><view class="m-product-bottom"><view><text class="m-product-price"><text v-if="!pointsMode" class="m-yen">¥</text>{{pointsMode?product.points:(product.price/100).toFixed(2).replace(/\.00$/,'')}}<text v-if="pointsMode" class="m-price-unit">积分</text></text><text class="m-stock">库存 {{product.stock}}</text></view><button role="button" class="m-add" :disabled="product.stock<1||product.enabled===false||product.enabled===0" :aria-label="pointsMode?'兑换'+product.name:'加入购物车 '+product.name" @click.stop="$emit('add',product)">{{pointsMode?'兑':'＋'}}</button></view></view>
  </view>
</template>
