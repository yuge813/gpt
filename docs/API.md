# 测试商城 API 使用约定

接口前缀 `/api`。H5 建议同源，小程序和 App 构建时设置可信 HTTPS 的 `VITE_API_BASE`。仅允许 `APP_MODE=demo`；本文件不代表真实支付、广告、数美接口已接入。

## 身份和权限

客户接口携带 `Authorization: Bearer <登录返回的token>`。管理接口独立使用 `X-Admin-Token`，凭证来自本机受控 `.env`，不写进 URL 或客户端构建配置。除公开目录、规则和健康检查外，请按接口要求鉴权；未登录返回401，管理员凭证错误返回403。

| 方法与路径 | 请求数据/用途 |
| --- | --- |
| POST /auth/register | `{username,password,consent:true}`，注册积分0，返回 `{token,user,mode}` |
| POST /auth/login | `{username,password}`，返回同一账号新会话 |
| POST /auth/password | `{currentPassword,newPassword}`，客户鉴权；撤销所有旧会话，返回当前新会话 |
| POST /auth/demo | `{consent:true}`，每次创建独立匿名体验账户，不与注册账号合并 |
| POST /auth/logout | `{}`，撤销当前会话 |
| GET /me | 当前账号、积分、待入账积分、签到状态 |

账号为3–32位ASCII字母/数字/下划线，统一小写；新密码12–128字符且不能全空白。没有密码找回。登录错误统一，失败锁定15分钟；路由限频及KDF并发保护可能返回429，请遵循重试提示。

## 客户购物和积分

| 方法与路径 | 用途 |
| --- | --- |
| GET /catalog、/points-rules | 已上架商品、配置及当前购物返积分倍率 |
| GET /cart | 当前账号购物车 |
| POST /cart | `{productId,quantity}`，数量1–20且需有库存 |
| POST /cart/remove | `{productId}` |
| GET /addresses | 当前账号地址 |
| POST /addresses | `{recipient,phone,detail}`，只填写虚构测试数据 |
| POST /addresses/remove | `{id}` |
| GET /coupons、/ledger | 优惠券、积分流水 |
| POST /shop/checkout | `{items:[{productId,quantity}],addressId,couponId,requestKey}` |
| GET /shop/orders | 购物订单、商家手工运单、售后信息 |
| POST /shop/orders/:id/demo-pay | `{}`，仅测试付款状态，不扣款 |
| POST /shop/orders/:id/receive | `{}`，仅已发货订单可确认并入积分 |
| POST /shop/orders/:id/cancel | `{}`，仅待付款可取消 |
| POST /shop/orders/:id/after-sales | `{reason}`，仅申请，不立即退款 |
| POST /orders | `{productId,requestKey}`，消耗积分兑换商品或购物券 |
| GET /orders | 积分兑换记录与 `fulfillment` 处理说明；区别于购物订单 |
| POST /checkin | `{}`，按服务端北京时间日期签到 |
| POST /ads/start、/ads/claim | 内部演示任务，不能用作正式广告凭证 |

所有价格、订单金额和优惠金额以**整数分**存储，积分为整数。请求不能指定任意价格、奖励或负数数量；严格Schema拒绝未知字段和字符串转数字。`couponId` 不用券时传空字符串。

`requestKey` 为16–128位字母数字下划线/连字符。同一账号相同幂等键只能对应同一次业务请求；更换商品、数量、地址、券必须使用新键。网络失败应先查询订单确认结果，重试相同业务保持原键，不能每次随意生成新键制造重复订单。

## 商家运营

| 方法与路径 | 用途 |
| --- | --- |
| GET /admin/overview | 真实测试记录统计、广告配置及审计 |
| GET /admin/products | 商品和库存版本 |
| POST /admin/products/save | 创建/编辑商品；编辑必须提交当前 `version`，过期返回409 |
| GET /admin/shop-orders | 购物订单和收货信息，需严格限制访问 |
| POST /admin/shop-orders/:id/ship | `{carrier,tracking}`，手工测试发货登记 |
| GET /admin/shop-orders/export.csv | 可选 `limit=1..1000`、`status`；默认100笔，UTF-8 BOM，公式防护，不含地址手机号 |
| GET /admin/after-sales | 售后申请 |
| POST /admin/after-sales/:id/resolve | `{decision:'approve'或'reject',note}` |
| GET /admin/redemptions | 最近200笔积分兑换记录 |
| POST /admin/redemptions/:id/fulfill | `{note}`，登记测试人工处理；同说明重试幂等，不允许覆盖说明或重复发券 |
| GET /admin/points-rules | 当前倍率 |
| POST /admin/points-rules | `{purchasePointsPerYuan:0到10整数}`；0暂停，新订单才应用新倍率 |

状态冲突、余额不足、库存变化或幂等键冲突返回409。错误响应包含可展示的 `message`，不能把409当成功。售后批准时，已发积分被消费导致不足会保留申请待审，当前没有真实资金退款与财务例外核销流程。

不要在 Bearer 会话API上叠加全站Basic Auth；会争用同一Authorization头。当前限流为单进程，正式公开服务仍需网关、分布式保护、身份治理和第三方真实沙箱验证。
