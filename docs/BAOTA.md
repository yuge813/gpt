# 宝塔受控测试部署

此文部署的是可验收的测试商城，不是已完成真实收款、广告变现及正式隐私合规的商用品。默认 `APP_MODE=demo`；不得改为其他模式来绕过缺失集成。测试站限制运营人员访问，使用虚构地址，不接收真实消费者订单。

## 1. 选择部署包并准备 Node

**优先使用预构建服务包** `delivery/aurora-0.3.0-server.zip`：它包含预构建 `public/` 网页、API 源码和独立运行依赖，不需要在服务器安装跨端编译器。解压到 `/www/wwwroot/aurora-release`，确认根目录有 `package.json`、`server/` 和 `public/`。

安装 Nginx 和 Node.js 24 LTS：

```bash
cd /www/wwwroot/aurora-release
node -v
npm ci --omit=dev
```

该包网页根目录为 `/www/wwwroot/aurora-release/public`，Node 启动命令为 `npm start`。后文凡使用源码目录 `/www/wwwroot/aurora`，服务包用户替换为 `/www/wwwroot/aurora-release`。

**从完整源码构建**也可：源码放 `/www/wwwroot/aurora`，确认有 `package.json` 和 `server/index.mjs`，执行：

```bash
cd /www/wwwroot/aurora
node -v
npm ci --include=dev
node scripts/doctor.mjs
npm run check
npm test
npm run build
```

源码方式网页根目录为 `/www/wwwroot/aurora/dist/build/h5`，Node 启动命令为 `npm run dev:api`。

两种方式都不能把项目根目录作为网页根目录。`.env`、`.data`、源码和备份不得暴露。任一步失败停止部署，保留原始错误；不要删除锁文件或禁用 TLS 校验。

## 2. 配置与进程

使用 `.env.example` 配置运行实例；若首次本地启动生成过 `.env`，安全复制自己的文件，不要覆盖。至少使用：

```dotenv
HOST=127.0.0.1
PORT=3001
APP_MODE=demo
DB_PATH=.data/aurora.sqlite
```

首次没有 `.env` 时，可在正确项目目录执行下面的初始化命令；若已有文件命令会拒绝覆盖，请安全编辑已有配置：

```bash
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
writeFileSync('.env',[
  'HOST=127.0.0.1','PORT=3001','APP_MODE=demo',
  'DB_PATH=.data/aurora.sqlite',
  `ADMIN_TOKEN=${randomBytes(32).toString('hex')}`,
  ''
].join('\n'),{flag:'wx',mode:0o600});
console.log('本地配置已初始化，凭证未输出');
JS
```

设置至少 32 字符的随机 `ADMIN_TOKEN`，值只留在受控服务器。不要放入 `VITE_*`、网页目录、聊天、日志或 Git。使用文件权限限制：

```bash
chmod 600 .env
```

在宝塔 Node 项目或 PM2 中设置与上述部署包对应的工作目录、Node 24，启动命令按上表选择（服务包 `npm start`，源码 `npm run dev:api`），开启进程守护和开机启动。不要用 Vite 开发服务器托管公开网页。3001 仅回环监听，不开放服务器安全组或宝塔防火墙的 3001 端口。

```bash
curl --fail http://127.0.0.1:3001/api/health
```

应返回 `ok:true`、`mode:demo`。这只证明 API 健康，仍需完成购物业务验收。

## 3. Nginx 网站

新建纯静态站点。预构建服务包的网页根目录必须是 `/www/wwwroot/aurora-release/public`；完整源码构建的网页根目录必须是：

```text
/www/wwwroot/aurora/dist/build/h5
```

解析域名并配置可信 HTTPS 证书、强制 HTTPS。证书申请相关的宝塔默认 `/.well-known/` 配置保持原样。

下面片段仅合并到对应站点的 `server` 块，不要覆盖整份配置；若已存在同名 `location`，编辑已有块。把 `203.0.113.10` 替换为你的测试人员公网 IP（该示例地址不能直接使用）。每个允许的 IPv4/IPv6 地址单独增加一条 `allow`。企业网络出口变化后需更新，不能为方便取消保护。

```nginx
location / {
    allow 203.0.113.10;
    deny all;
    try_files $uri $uri/ /index.html;
}

location /api/ {
    allow 203.0.113.10;
    deny all;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 30s;
}
```

**修正早期说明：整站直接叠加 Basic Auth 会与当前 API 登录方式冲突。** API 使用 Bearer 会话，不要在 `/api/` 叠加要求 `Authorization: Basic` 的 `auth_basic`，否则会与客户登录凭证冲突。如果改用认证网关，应采用经过验证的独立 Cookie 会话保护，并确保静态页面和 API 都受保护；不要只保护首页而暴露 API。

宝塔某些正则静态资源 `location` 可能绕过 `/` 的 IP 限制，需将相同 allow/deny 规则加到这些块，或移除不必要的单独正则块。使用未放行的网络验证首页、JS、图片和 `/api/health` 均被拒绝。不要仅凭配置文件看起来正确就声称保护已生效。

前端默认同域 `/api` 代理到后端，通常不需要 `VITE_API_BASE`。如使用另一个 API 域名，构建前设置该变量并配置准确 CORS、TLS、访问保护；不得使用 `*` 代替生产安全设计。

## 4. 备份与升级

SQLite 使用 WAL；不能在服务写入时只复制 `aurora.sqlite`，否则可能丢失未 checkpoint 的事务。可在停服后备份完整数据库目录，或使用 SQLite 在线备份 API 获得一致快照。备份必须放在网站根目录外并限制读取。

完整源码项目提供 `npm run backup`（PowerShell 为 `npm.cmd run backup`），使用 Node 24 的 SQLite 在线备份 API，将一致性快照写入被忽略的 `.backups/`，按输出确认校验成功。不要把 `.backups/` 放入网页根目录或公开下载包。

如果预构建服务包未包含这个辅助脚本，可使用下面的等价 Node 24 示例，针对默认数据库路径；自定义 `DB_PATH` 时调整本机路径，不要打印 `.env`：

```bash
cd /www/wwwroot/aurora
node --input-type=module <<'JS'
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
const folder='/www/backup/aurora';
mkdirSync(folder,{recursive:true,mode:0o700});
const target=folder+'/aurora-'+Date.now()+'.sqlite';
const db=new DatabaseSync('.data/aurora.sqlite',{readOnly:true});
await backup(db,target);
db.close();
chmodSync(target,0o600);
const snapshot=new DatabaseSync(target,{readOnly:true});
const result=snapshot.prepare('PRAGMA integrity_check').get();
snapshot.close();
if(Object.values(result)[0]!=='ok')throw new Error('Backup integrity check failed');
console.log('数据库一致性备份验证通过');
JS
```

另行安全备份 `.env`、当前代码版本和配置，备份不进入 Git。更新前先备份并验证恢复方案；停止运行中的安装和构建进程，不覆盖 `.env` 与 `.data`，执行冻结依赖安装、测试、构建，重启 API，再验收。增量迁移不能当作数据库回滚脚本，必要时回滚到完整备份和对应代码。

## 5. 部署验收

- 允许访问的网络：网页 HTTPS 正常，API 显示测试模式，客户和管理员分别操作。
- 未放行网络：首页、静态资源、API 均拒绝。
- 确认网页请求拿不到 `.env`、`.data` 或项目源码。
- 商品上下架、库存与规则修改能在客户页面反映；冲突修改不会覆盖已占用库存。
- 客户不能替商家发货；商家记录承运商及单号后，客户才可收货。
- 付款不发可用积分，收货只发一次，售后审核回收积分且不产生真实退款。
- 真正支付、真实广告、数美、账号体系、签名 App 和平台发布继续列为未完成，不得标为已上线。
