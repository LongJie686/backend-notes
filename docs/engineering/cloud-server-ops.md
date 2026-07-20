# 云服务器部署与运维经验

> 提炼自 CrossSail 看板（腾讯云香港轻量 2核4G，Node + SQLite + Nginx）与 AI 工作流 worker 的生产部署实践。
> 最新更新: 2026-07-20

---

## 核心结论

1. 上云还是本地跑，按「公网稳定性需求」和「带宽消耗」两个维度决策，不是所有服务都该上云
2. 服务器到手第一件事是安全加固：普通用户 + 密钥登录 + 禁 root 禁密码 + 防火墙只开必要端口
3. 生产密钥必须部署时现场随机生成，绝不复用开发环境的值
4. SQLite WAL 模式下直接 cp .db 文件做备份会丢数据——已提交的数据可能还在 -wal 文件里
5. 更新上线的功夫全在动手前：低峰窗口、停掉定时任务、先备份、想好回滚路径

---

## 一、部署形态决策：上云 vs 本地

| 维度 | 上云 | 本地电脑/NUC |
|------|------|-------------|
| 适合的负载 | 面向团队的 Web 服务（看板/API），要求公网稳定、双向低延迟 | 大带宽 I/O 任务（生图/生视频下载上传）、只服务单一办公室 |
| 理由 | 7x24 稳定、HTTPS、免维护硬件 | 内网千兆随便跑，不占云服务器带宽，硬件要求低（I/O 密集 8G 内存足够） |
| 公网暴露 | 必须（Nginx + HTTPS） | 可以完全不暴露：以飞书表格等 SaaS 为交互面，本地纯轮询 |

配套决策：

- **境外 API 多、面向国内团队**：选香港节点——双向延迟低 + 免备案；地域创建后不可切换，选错只能重买
- **本地机器没有公网 IP**：异步任务一律轮询模式，不用回调，所有主流生成类 API 都支持
- **带宽紧张**（如 6Mbps 轻量）：静态资源迁 CDN/对象存储，服务器只留 API，带宽压力大幅下降

---

## 二、首次登录安全加固（标准动作）

```bash
# 1. 新建普通用户，避免长期用 root
adduser cs && usermod -aG sudo cs

# 2. 配置 SSH 公钥
mkdir -p ~/.ssh && chmod 700 ~/.ssh
# 粘贴本地公钥到 ~/.ssh/authorized_keys，chmod 600

# 3. 禁密码登录与 root 直登（/etc/ssh/sshd_config）
#    PasswordAuthentication no
#    PermitRootLogin no
sudo systemctl restart ssh

# 4. 防火墙只开必要端口
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443
sudo ufw enable
```

**防锁死自己**：改完 sshd_config 后先别关当前终端，另开一个终端验证密钥登录成功，再关旧的。

---

## 三、生产密钥管理

```bash
# 部署时现场生成随机强密钥，不复用开发值
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# 写入 .env 后锁权限
chmod 600 .env
```

- 第三方平台 token 入库前用 AES-256-GCM 加密，列表接口只返回脱敏值（`shpa****c123`）
- **加密密钥丢失 = 库内所有密文作废**，需重新向各平台申请 token。`.env` 要离线备份一份（密码管理器）
- 泄露过的密钥一律轮换，不存侥幸

---

## 四、标准服务链路：PM2 + Nginx + HTTPS

```bash
# 进程守护 + 开机自启
pm2 start server.js --name my-api
pm2 save && pm2 startup   # startup 输出的 sudo 命令要手动执行

# Nginx 反代要点：client_max_body_size（上传接口）+ X-Forwarded-* 头
sudo nginx -t && sudo systemctl reload nginx

# HTTPS：certbot 一条命令，自动续期
sudo certbot --nginx -d your-domain.com
```

监控页这类纯静态低频页面直接 nginx alias 托管静态 HTML（配合 meta 自刷新），不值得为它起服务。

---

## 五、定时任务与备份

```cron
# 采集类任务错开整点（第 5 分钟），日志追加落盘
5 * * * * cd /opt/app && ./venv/bin/python fetch_data.py >> /var/log/app-fetch.log 2>&1
# 每日备份 + 保留 30 天
0 3 * * * <备份命令> && find /opt/app/backup -mtime +30 -delete
```

### SQLite WAL 备份坑（重要）

WAL 模式下已提交数据可能还在 `-wal` 文件里没合并进 `.db`，**直接 `cp xxx.db` 会丢数据**。正确做法：

- 用专门的备份脚本（走 SQLite backup API 或 `VACUUM INTO`）
- 备份后做完整性校验（能打开、关键表行数合理）
- 恢复也走脚本，自动清理残留的 `-wal`/`-shm`
- 运行目录出现 `-wal`/`-shm` 文件属正常，勿手动删

SQLite 本身的适用场景见 [SQLite](/database/sqlite)：小数据量（万行级/年）单文件零运维，比 PostgreSQL 更合适。

---

## 六、更新上线策略（核心经验）

一次平滑升级的完整动作序列：

| 阶段 | 动作 | 理由 |
|------|------|------|
| 1. 选窗口 | 低峰时段（凌晨/午休）+ 提前群里知会 | 中断 1~2 分钟也不打断别人工作 |
| 2. 排空 | 确认无定时任务在跑（锁文件 + `fuser` 查占用）；临时注释 crontab 相关行 | 防升级中途与采集/备份撞车 |
| 3. 备份 | 先跑一次备份再动代码 | 出事有底 |
| 4. 更新 | `git pull` + 装依赖 + `pm2 restart` | 依赖优先选官方预编译包，避免服务器上现场编译 |
| 5. 验证 | `curl -sf /api/health`、`pm2 logs` 看无报错、浏览器人工抽查数据 | 健康检查 + 日志 + 业务三层验证 |
| 6. 恢复 | 恢复 crontab 注释的行 | 别忘了 |

**回滚路径要在升级前想清楚**：数据文件格式不变（如 sql.js 迁 better-sqlite3，读写同一 SQLite 格式）才能 `git revert` 直接回退；涉及数据迁移的升级要准备反向迁移或以备份恢复兜底。回滚前也先备份一次。

---

## 七、常用运维命令

| 操作 | 命令 |
|------|------|
| 服务状态 / 日志 | `pm2 status` / `pm2 logs my-api --lines 20` |
| 更新代码后重启 | `git pull && npm install --omit=dev && pm2 restart my-api` |
| 健康检查 | `curl -sf http://127.0.0.1:3000/api/health && echo OK` |
| 证书续期演练 | `sudo certbot renew --dry-run` |
| 防火墙状态 | `sudo ufw status` |
| 查端口占用进程 | `netstat -ano \| grep <port>` 后按 PID 查进程 |

---

## 相关笔记

- [AI 生成类工作流工程化经验](/ai-app/ai-workflow-engineering)：跑在这类服务器上的 worker 的可靠性设计（轮询/兜底/孤儿恢复）
- [监控告警](/engineering/monitoring)
- [Docker](/engineering/docker)：容器化部署路线
