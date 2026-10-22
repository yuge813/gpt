# 曜集商城 · 0.4.0 受控试用版

购物返积分商城，包含用户商城和独立商家运营后台。uni-app + Vue 3 共用客户端、Fastify + SQLite API。明亮移动商城界面，商品价格与返积分同屏展示。

**当前交付用于内部或受控试用，不真实收款、退款、发货或产生广告收入。** 没有复制参考站源码或图片；商品摄影是示意图，不构成品牌授权。不能将此版本当成已通过安全认证的商用系统。

## 最简单的运行方式：免前端编译部署包

下载 `delivery/aurora-0.4.0-server.zip` 并解压。需要 Node.js 24+，已验证基线为 Node 24 LTS。

Windows 可直接双击解压目录的 `START-WINDOWS.cmd`，或在解压目录打开 PowerShell 执行：

```powershell
npm.cmd ci --omit=dev
npm.cmd start
```

Linux / 宝塔：

```bash
npm ci --omit=dev
npm start
```

这个包只安装 API 运行依赖，网页已构建，不需要 HBuilderX、Vite 或 Python。首页与 API 默认同为本机 3001 端口。打开浏览器访问本机该端口即可；不要将本机地址当成公网链接。首次启动会创建 `.env` 并生成随机运营凭证，不打印密钥，也不会覆盖已有配置。

商家后台入口位于网站页脚和个人中心；在本机安全查看 `.env` 中的 `ADMIN_TOKEN` 登录，不能发送到聊天、截图或公开仓库。

## 从源码开发

```bash
npm ci --include=dev
npm run doctor
npm run start:local
```

PowerShell 使用 `npm.cmd` 替代 `npm`，不需要放宽系统执行策略。开发启动脚本检查依赖和端口，先等待 API 就绪，再启动 H5；不会自动结束未知进程。默认 API 3001、H5 5173，端口被占用会明确报错，不自动跳到另一个端口。

可在 `.env` 设置 `PORT` 和 `FRONTEND_PORT`，Vite 代理随 API 端口调整。已有 `.env` 不会覆盖。不要一边运行 HBuilderX 一边重新安装依赖，也不要同时启动两份项目。

## 本版新增

- Windows 双击启动脚本，自动进入正确目录，避免在用户目录执行 npm。
- 客户订单按订单号、商品名搜索，结合订单状态筛选。
- 商家鉴权订单 CSV 导出，限制导出条数并防止表格公式注入。

## 商家运营能力

- 商品创建、编辑、上下架、价格、积分价格与库存；版本校验防止覆盖订单造成的库存变更。
- 商家查看购物订单、收货信息，登记承运商及单号；客户查看手工物流记录并确认收货。没有实时物流 API。
- 客户申请售后，商家填写意见批准或驳回；批准后原子处理测试退款、库存、购物券及积分回收。
- 返积分已被使用导致余额不足时，保留待审并返回明确错误，不伪造退款成功或制造负积分。
- 后台配置购物返积分倍率 0–10，0 表示暂停。新订单使用新规则，旧订单使用下单时的奖励快照。
- 专用运营界面，商品、订单、售后、积分规则、广告位置、本地风控与操作审计分区。

已有功能：分类/搜索/排序、商品详情、收藏、购物车、地址、优惠券、结算、订单状态、积分明细、积分兑券与商品、签到、内部广告激励演示。新账户从 0 积分开始；旧版余额保留。签到/广告是补充任务，不是购物主线。

## 验收与构建

```bash
npm run check
npm test
npm run test:e2e
npm run build
npm run build:weixin
npm run build:app
```

浏览器测试需 Chromium，默认 `/usr/bin/chromium`，可用 `CHROMIUM_PATH` 指定。运行前停止本项目的 3001/5173 服务。测试使用独立数据库；固定测试凭证只用于测试进程。

H5 输出 `dist/build/h5`，小程序输出 `dist/build/mp-weixin`，App 共用资源输出 `dist/build/app`。App 资源不是签名 APK/IPA；编译不等于真机及商店审核通过。

维护者在有 Python 3 的构建环境执行 `npm run package:release` 可重建部署包；普通使用者不需要此步骤。运行 `npm run backup` 生成 SQLite 在线一致性备份并校验，备份位于被忽略的 `.backups/`，包含业务数据，应限制权限并保存到受控异机位置。

## 部署、升级及边界

- [Windows / HBuilderX 指南](docs/WINDOWS.md)
- [宝塔部署指南](docs/BAOTA.md)：包含访问范围限制，以及全站 Basic Auth 与 Bearer 会话冲突的修正。
- [功能验收清单](docs/ACCEPTANCE.md) · [交付状态及上线条件](docs/DELIVERY-STATUS.md)
- [四端和第三方服务边界](docs/PLATFORMS.md)
- [安全状态](docs/SECURITY.md) · [素材说明](docs/ASSETS.md)
- 最近验证证据：`docs/validation.json`；真实浏览器截图：`docs/screenshots/`。

升级前备份并保留自己的 `.env`、`.data`。源码与部署包都有数据库增量迁移；不要只升级前端、不要复制旧 node_modules、不要在运行写入时复制单个 SQLite 数据库文件。不要把项目根目录作为 Nginx 网页根目录，也不要公开配置、数据库或备份。

真实微信/支付宝支付与退款网关、穿山甲/微信广告、数美、生产账号认证、后台 MFA/RBAC、完整隐私/注销、实际物流与履约及平台审核仍未完成。正式模式拒绝启动。收费随机获奖机制未实现，需单独审查；积分不支持买卖、提现、转让或朋友圈分享奖励。
