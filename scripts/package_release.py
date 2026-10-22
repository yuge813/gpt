"""Build a reviewed deployment archive without secrets, data or developer dependencies."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
build = root / 'dist/build/h5'
if not (build / 'index.html').is_file():
    raise SystemExit('Build H5 first: npm run build')
bundle = root / '.release' / ('aurora-' + version + '-server')
if bundle.exists():
    previous_manifest = bundle / 'MANIFEST.sha256.json'
    if any((bundle / name).exists() for name in ('.env', '.data', '.backups', 'node_modules')):
        raise SystemExit('Refusing to replace a used runtime directory. Back up its configuration/data and choose a clean build directory first: ' + str(bundle))
    if not previous_manifest.is_file():
        raise SystemExit('Refusing to replace an unknown directory: ' + str(bundle))
    previous = json.loads(previous_manifest.read_text())
    for existing in bundle.rglob('*'):
        if existing.is_file() and existing != previous_manifest:
            rel = existing.relative_to(bundle).as_posix()
            if rel not in previous or hashlib.sha256(existing.read_bytes()).hexdigest() != previous[rel]:
                raise SystemExit('Refusing to discard a modified or added runtime file: ' + rel)
    shutil.rmtree(bundle)
bundle.mkdir(parents=True)
for name in ('package.json', 'package-lock.json'):
    shutil.copy2(root / 'runtime' / name, bundle / name)
shutil.copy2(root / '.env.example', bundle / '.env.example')
shutil.copy2(root / 'START-WINDOWS.cmd', bundle / 'START-WINDOWS.cmd')
(bundle / '.npmrc').write_text('cache=.npm-cache\nsave-exact=true\n')
for path in sorted((root / 'server').glob('*.mjs')):
    if not path.name.endswith('.test.mjs'):
        (bundle / 'server').mkdir(exist_ok=True)
        shutil.copy2(path, bundle / 'server' / path.name)
(bundle / 'scripts').mkdir()
for name in ('serve.mjs', 'runtime.mjs', 'backup.mjs', 'doctor.mjs', 'restore.mjs'):
    shutil.copy2(root / 'scripts' / name, bundle / 'scripts' / name)
shutil.copytree(build, bundle / 'public')
(bundle / 'docs').mkdir()
for name in ('BAOTA.md', 'WINDOWS.md', 'ACCEPTANCE.md', 'SECURITY.md', 'ASSETS.md', 'DELIVERY-STATUS.md', 'RESTORE.md', 'REFERENCE-COMPARISON.md', 'API.md'):
    shutil.copy2(root / 'docs' / name, bundle / 'docs' / name)
(bundle / 'README.md').write_text(f'''# 曜集 {version} · 预构建测试服务包

本包不需要 HBuilderX、Vite、Vue 编译器或 Python。需要 Node.js 24+ 和 npm。

Windows：解压全部文件后双击 `START-WINDOWS.cmd`，自动进入正确目录、检查环境并安装缺失依赖。
启动器不会修改已有 `.env` 或 `.data`；出错会暂停显示原因。

也可在解压目录使用 PowerShell：

```powershell
npm.cmd ci --omit=dev
npm.cmd start
```

Linux / 宝塔：

```bash
npm ci --omit=dev
npm start
```

默认仅监听本机 3001，首页和 API 同端口。打开该电脑浏览器访问 http://127.0.0.1:3001/ 。
宝塔公开访问必须按 docs/BAOTA.md 设置 HTTPS 和访问范围限制，禁止把源码根目录设为网站根目录。

首次启动会创建 .env 并生成随机后台 ADMIN_TOKEN，不会打印凭证或覆盖旧配置。
后台入口在网站页脚及个人中心；请在本机安全查看 .env 使用运营凭证，不要公开或发送给他人。
检查环境：npm run doctor。数据库一致性备份：npm run backup。
恢复到全新独立文件：参见 docs/RESTORE.md；不会自动切换运行数据。
升级前备份并保留自己的 .env、.data；不要复制旧 node_modules 或覆盖生产数据。

已包含账号密码注册/登录/改密、商品库存、订单、商家发货记录、售后审核、积分规则与兑换处理记录。
匿名体验与注册账号不自动合并；没有密码找回功能，请妥善保管账号和密码。
仍为测试环境：不真实收款、退款、发货或展示广告；不代表完成四端真机与平台审核。
业务数据与个人信息保护仍不满足生产门槛。商品图片为示意图，非品牌授权证明。
''', encoding='utf-8')
manifest = {}
for path in sorted(bundle.rglob('*')):
    if path.is_file():
        manifest[path.relative_to(bundle).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
(bundle / 'MANIFEST.sha256.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
delivery = root / 'delivery'
delivery.mkdir(exist_ok=True)
archive = delivery / f'aurora-{version}-server.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
    for path in sorted(bundle.rglob('*')):
        if path.is_file():
            rel = path.relative_to(bundle)
            if path.name == '.env' or any(p in ('.data', '.backups', 'node_modules', '.git', '.npm-cache') for p in rel.parts):
                raise SystemExit('Refusing to package private data: ' + str(rel))
            output.write(path, rel)
with zipfile.ZipFile(archive) as output:
    if output.testzip() is not None:
        raise SystemExit('Archive integrity failed')
    for rel, expected in manifest.items():
        if hashlib.sha256(output.read(rel)).hexdigest() != expected:
            raise SystemExit('Archive content mismatch: ' + rel)
(archive.with_suffix('.zip.sha256')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print(f'Release archive: {archive.relative_to(root)} ({archive.stat().st_size} bytes)')
print('Content hashes verified; no credentials, local database, backups or node_modules included.')
