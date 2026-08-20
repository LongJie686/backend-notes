# CrossSail 看板

Shopify + Facebook 广告数据看板，同时充当整个 `xingjilong.top` 门户的鉴权后端——
其他所有服务的 nginx `auth_request` 都回源到它的 `/api/auth/verify`。

- 本地：`D:\Aproject\CrossSail\`
- 仓库：`LongJie686/shopify-fb-dashboard`（main 分支，私有）
- 线上：pm2 `crosssail-api`，端口 3000

## 项目构成

三个松散组件，只有 `server/` 有 package.json：

| 目录 | 内容 |
|------|------|
| `server/` | Node.js + Express 后端，入口 `server/server.js`，同时用 `express.static` 托管根目录前端页面 |
| `index.html` / `monitor.html` | 前端是**单文件原生 HTML**，内联 JS+CSS，无框架无构建步骤 |
| `tools/` | Python 3 采集与运维脚本（argparse 命令行） |

纯 JavaScript 无 TypeScript，无格式化强制（不要引入 Prettier 做全量重排）。
CI 是 GitHub Actions：server 的 lint+test、tools 的 ruff。

改前端就是直接编辑那两个 HTML 文件，**不要引入 React/Vite/Webpack**。

## 常用命令

```bash
cd server && npm install && npm start   # 监听 3000（start 与 dev 相同，无热重载）
python tools/fetch_data.py --mock       # 采集，--mock 演示数据 / --live 真实采集
cd server && npm test                   # node:test + supertest
cd server && npm run lint               # ESLint
ruff check tools/                       # Python
cd server && npm run screenshot         # Playwright 截图自查前端
```

相关笔记：[Docker](/engineering/docker)、[Git](/engineering/git)

## 数据库：better-sqlite3（关键，容易踩坑）

2026-07-16 从 sql.js 迁移到 **better-sqlite3**，WAL 模式 + `busy_timeout` 5s。
写入实时持久化，`kill -9` 不丢已提交数据；SQL 错误正常抛出
（旧 sql.js 包装类静默吞错的行为已移除），由 Express 终端错误中间件兜底。

**Node 与 Python 可以并发直写同一个文件**：WAL 下读写互不阻塞，写写靠 `busy_timeout` 排队
（Python sqlite3 默认也是 5s，两侧对齐）。Python 提交后 Node 下一条查询即可见，
不需要重启或重读。`cron_fetch.sh` 因此取消了旧的「停-写-启」流程。

其他要点：

- `flushDb()` 现在是 WAL checkpoint（把 `-wal` 收敛回主库）；
  `POST /api/admin/db-flush` 兼容保留，调用无副作用。
- **故意不开启 `foreign_keys`**：历史写入路径（比如待分派店铺挂 g0）从来没受过外键约束，
  开启会让既有路径直接报错。
- **从备份恢复时必须删掉主库旁残留的 `-wal` / `-shm`**，否则旧 WAL 事务会回放进新库。
  `tools/ops.py restore` 已自动处理。

相关笔记：[SQLite](/database/sqlite)、[MySQL 事务](/database/mysql-notes/lecture-3)

## 测试注意

- 测试通过 `DB_PATH` 环境变量指向临时库，不污染开发用的 `dashboard.db`。
  写新测试文件必须在 `require('../server')` **之前**设置 `process.env.DB_PATH`；
  `after()` 里先 `closeDb()` 再删临时库及其 `-wal/-shm`（Windows 下不关连接删不掉文件）。
- `server.js` 导出 `{ app, initApp }`，只在 `require.main === module` 时才 listen；
  测试用 supertest 直接打 app，不占端口。
- 限流相关测试放独立文件（`node --test` 每个文件单独进程，限流计数互不影响）；
  单文件内登录请求控制在 10 次以内，否则触发 `loginLimiter`。

## 安全（fail-closed）

- `JWT_SECRET` **未配置直接拒绝启动**，没有默认值兜底。
  `NODE_ENV=production` 下还要求 ≥32 位，否则拒绝启动（防弱密钥爆破伪造 admin）。
- 生产必须设 `NODE_ENV=production` 才激活上述校验。

## 运维状态

- 部署走 tar + scp，服务器不是 git 仓库；`deploy_watch.sh` 会挑服务空闲时自动上线。
- **CrossSail 是目前唯一有每日备份的服务**（`cron_backup.sh`），
  元素提取和创意生图的历史库参照它补齐。
- 已知待办：Shopify jesusaveus 的凭证 2026-07-28 起失效导致采集 401，
  当时缺少凭证失效告警，看板缺了 6 天数据。需要补一条告警。
- 2026-07-21 曾因脚本权限 + CRLF 换行导致采集停摆 5 天；
  Facebook 应用被 Meta 删除（code 190）需重签 token。

相关笔记：[监控告警](/engineering/monitoring)、[云服务器运维](/engineering/cloud-server-ops)
