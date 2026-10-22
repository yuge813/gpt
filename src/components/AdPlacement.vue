<script setup lang="ts">
defineProps<{name:string;format:string}>()
defineEmits<{(event:'explore'):void}>()
</script>
<template>
  <view class="ad-placement"><view><text class="ad-placement-tag">广告位 · 内部占位预览</text><text class="ad-placement-title">{{name}}</text><text class="muted">正式广告未接入 · {{format}} · 不统计展示或收益</text></view><button role="button" class="secondary" @click="$emit('explore')">查看激励演示 ↗</button></view>
</template>
<style scoped>
.ad-placement{margin:20px 0;border:1px dashed #b3d8bf30;border-radius:11px;background:linear-gradient(110deg,#24352e66,#192332);padding:22px;display:flex;align-items:center;justify-content:space-between;gap:18px}.ad-placement-tag{font-size:8px;color:#c4bd9e;display:block;letter-spacing:1px}.ad-placement-title{font-size:18px;color:#d9e6d7;display:block;margin:5px 0}.ad-placement button{font-size:11px;flex-shrink:0}@media(max-width:700px){.ad-placement{padding:17px;flex-wrap:wrap}.ad-placement-title{font-size:15px}.ad-placement .muted{font-size:9px}.ad-placement button{padding:8px 13px;font-size:10px}}
</style>
