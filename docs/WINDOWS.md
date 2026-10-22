# Windows / HBuilderX 本地运行

本版本用于受控测试，不产生真实支付、广告收入或发货。Node.js 24 LTS 是已验证基线；项目要求 Node >=24。HBuilderX 的前端预览不能替代 API 服务。

## 免编译服务包（优先）

下载最新 `delivery/aurora-*-server.zip`，选择“全部解压缩”到新目录，然后双击 `START-WINDOWS.cmd`。不要在 ZIP 预览窗口中直接运行。启动器自动进入自身目录，检查 Node.js >=24、npm 和完整交付文件，首次或依赖不完整时执行锁定版本安装；安装失败会暂停，不会继续启动。再次启动时已有依赖可直接使用。

保持终端窗口开启，按启动输出打开浏览器。启动器不会覆盖已有 `.env`、数据库或备份，不会更改 PowerShell 执行策略。脚本使用英文提示以兼容 Windows 控制台编码；当前在云环境做静态校验，尚未进行 Windows 真机验证。

若使用 PowerShell 手工启动：先在资源管理器打开解压后的文件夹，确认能看到 `package.json`、`package-lock.json`、`public` 和 `server`，在地址栏输入 `powershell` 后回车，再执行：

```powershell
npm.cmd ci --omit=dev
npm.cmd start
```

本包网页已构建，不需要 HBuilderX，也不要在其中执行 `start:local`。默认同一个 3001 端口提供网页与 API；打开本机浏览器访问该端口。后端启动成功前不要关闭终端。以下章节适用于需要修改源码的开发方式。

## 首次启动或从旧源码 ZIP 升级

1. 在 HBuilderX 停止该项目，其他运行此项目的终端按 Ctrl+C。不要结束自己不认识的端口进程。
2. 备份旧项目，保留自己的 `.env`、`.data`；将 GitHub 同一交付分支的源码解压到新目录。不要复制旧 `node_modules` 和构建缓存。需要延续测试数据时，在服务停止后复制完整 `.data` 目录，而不是在数据库写入时复制单个 SQLite 文件。
3. PowerShell 中进入包含 `package.json` 的目录：

```powershell
Set-Location 'I:\云电脑\积分商城\gpt-codex-aurora-demo-delivery'
node -v
npm.cmd ci --include=dev --cache "$env:TEMP\aurora-npm-cache"
```

安装成功后才启动，不要一边安装依赖一边继续 HBuilderX 编译。

```powershell
node scripts/doctor.mjs
npm.cmd run start:local
```

脚本会运行前端与后端；保持该 PowerShell 窗口开启。使用实际输出的浏览器地址，不要假设自动变为另一个端口。默认 API 为 3001，H5 为 5173。若端口已占用，先确认是不是旧项目正在运行；不要随意关闭其他服务。

首次启动会生成被 Git 忽略的 `.env` 和随机后台凭证，不会覆盖已有 `.env`。运营后台使用 `.env` 中的 `ADMIN_TOKEN`，不要将它发到聊天、截图或公开仓库。

## 常见故障

| 现象 | 检查与处理 |
| --- | --- |
| 找不到 `C:\Users\Administrator\package.json` 或提示锁文件不存在 | 当前目录错误；使用双击启动器，或从完整解压后的项目目录打开 PowerShell；不要删除锁文件或改用 `npm install` 掩盖目录问题 |
| 禁止运行 `npm.ps1` | 使用 `npm.cmd`，不需要修改执行策略 |
| 缺少 `vite-plugin-uni/bin/uni.js`、`uni-h5` 或 `postcss.js` | 停止前后端，执行上面的完整 `npm.cmd ci --include=dev`；检查安装是否真的成功 |
| `ECONNREFUSED 127.0.0.1:3001` | API 尚未启动或已退出；看启动终端 API 错误，不能只运行 HBuilderX 前端 |
| 页面连接失败但能看到 UI | 执行 `node scripts/doctor.mjs --network`，确认 API 健康检查；不要把模拟页面可见当成业务已连接 |
| HBuilderX 与终端抢占端口 | 本地联调只使用 `npm.cmd run start:local` 启动；停止重复运行 |
| `npm ci` 报锁文件不匹配 | 保留错误输出并反馈，不要删除锁文件或使用任意升级覆盖错误 |
| 公司代理/证书导致安装失败 | 按组织要求配置可信 CA 或代理；不要关闭 TLS、包完整性或签名校验 |

## 验收路径

登录测试账户 → 加入购物车 → 填写虚构测试地址 → 测试付款 → 商家后台登记发货 → 客户确认收货 → 积分入账 → 兑换购物券 → 下一单结算抵扣。

客户端不再用“模拟发货”代替商家操作。售后由客户提出申请，运营后台审核；真实资金退款及物流查询仍未接入。完整验收范围见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 其他客户端

H5 预览通过不代表小程序或 App 真机验收通过。设备端不能使用电脑的 `127.0.0.1` 访问 API；需配置设备可访问的 HTTPS API、合法域名和平台 AppID。Android/iOS 的编译资源不等于已签名安装包。
