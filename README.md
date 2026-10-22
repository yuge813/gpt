# 曜集 AURORA

原创积分生活商城，uni-app + Vue 3 四端共用界面，Fastify + SQLite 独立 API。深色松绿与香槟金视觉、原创 SVG 商品插画，桌面侧栏与移动端底栏自适应。

**当前为可运行演示版，不是真实广告变现或可直接商用的交付版。** 没有复制参考站源码或图片。商品、积分、订单均为演示，兑换不发货、不收款。

## 启动

需要 Node.js 24+、npm 11。

```bash
cd /workspace/gpt
npm ci
npm run start:local
```

启动脚本首次创建被 Git 忽略的 `.env`，生成随机运营访问凭证（不输出密钥），并启动 API 3001 与 H5 5173。Ctrl+C 停止脚本启动的进程。若已有 `.env`，不会覆盖；配置项参考 `.env.example`。运营后台入口在侧栏底部及个人中心，使用本机 `.env` 中的 `ADMIN_TOKEN`，不要在聊天或日志中粘贴。

也可在两个终端分别运行 `npm run dev:api` 和 `npm run dev`。服务默认绑定 127.0.0.1，API `/api/health` 应返回 `mode: demo`。不要将 Vite 开发服务直接暴露到公网。

## 验证与构建

```bash
npm run check
npm test
npm run test:e2e
npm run build
npm run build:weixin
npm run build:app
```

浏览器测试默认使用 `/usr/bin/chromium`；其他环境可设置 `CHROMIUM_PATH` 为已安装的 Chromium 路径，或调整 Playwright 配置使用其官方安装的浏览器。测试会独立启动服务，3001 与 5173 必须空闲；每次运行使用独立的 `.data/e2e-<进程号>.sqlite`，不会接触开发数据库。端到端测试里的固定运营凭证仅在该测试进程有效。

H5 输出 `dist/build/h5`，小程序输出 `dist/build/mp-weixin`，App 共用资源输出 `dist/build/app`。后者不是已签名 APK/IPA。设备构建前配置可访问的 `VITE_API_BASE` 并填入自己的平台 AppID。

## 已实现

商城搜索/分类/排序、心愿单、演示登录与退出、签到及连续奖励、广告内部演示、积分明细、原子兑换与订单、广告占位管理、运营统计、本地风控、账户限制与解除、操作审计。

广告奖励每日最多五次，间隔至少 30 秒，完整演示后加 30 积分。签到日期按北京时间；普通日 20 分，每连续第七天 100 分。初次体验发 1,200 分。积分不支持买卖、提现、转让、抽奖或朋友圈分享奖励。

## 交付边界

- [四端发布与广告/风控接入](docs/PLATFORMS.md)
- [安全状态及上线门槛](docs/SECURITY.md)
- `docs/screenshots/` 保存真实浏览器运行截图。
- `docs/validation.json` 保存验证结果，未执行或未完成的项目不得视为通过。

穿山甲、微信广告、数美、真实认证、支付、物流、生产后台权限与账号注销未接入；正式模式目前拒绝启动。真实接入需要平台资质、账号、签名/广告位配置、合同或收费服务及真实设备验收。不能靠模拟接口替代。
