export type ShopProduct={id:string;name:string;subtitle:string;category:string;price:number;points:number;stock:number;art:string;color:string;badge:string;rewardPoints:number;quantity?:number}
export const money=(amount:number)=>(amount/100).toFixed(2)
export const orderStatus:Record<string,string>={pending:'待付款',paid:'待发货',shipped:'待收货',completed:'已完成',cancelled:'已取消',refunded:'已退款'}
export const photo=(art:string)=>`/static/${art}.${art==='coupon'?'svg':'jpg'}`
