# TgContactBot

> 一个部署在 **Cloudflare Workers** + **D1 数据库** 上的高性能 Telegram 留言板机器人。  
> A high-performance Telegram contact bot running on **Cloudflare Workers** + **D1 Database**.

---

## ✨ 功能特性 / Features

| 功能 | Feature |
|------|---------|
| 🛡️ 数学验证码防护（3次失败→封禁6小时） | Math CAPTCHA with 3-strike temp ban |
| 🌐 中英双语界面，管理员可随时切换 | Bilingual UI (zh/en), switchable per admin |
| 🚫 关键词 + 正则垃圾过滤，支持远程黑名单 | Keyword & regex spam filter with remote blocklist |
| 💤 自动上下班回复 | Business hours auto-reply |
| ⚡ 防刷屏频率限制 | Anti-flood rate limiting |
| 🗂️ 话题模式（群组）/ 私聊模式 双支持 | Topic mode (Group) & Legacy (Private) support |
| � 模板快捷回复 | Template quick replies |
| 📊 统计信息、消息日志、日志定时清理 | Stats, message logs, retention cleanup |
| 📡 白名单、全局广播 | Whitelist, broadcast to all users |

---

## 📂 项目结构 / Project Structure

```
TgContactBot/
├── index.js            # Worker 入口包装 / Entry wrapper
├── wrangler.toml       # CF 部署配置 / Deployment config
├── schema.sql          # 数据库建表 SQL / DB schema
└── src/
    ├── index.js        # 路由分发 / Request router
    ├── config.js       # 配置读取 / Config loader
    ├── commands/       # 命令处理 / Command handlers
    ├── core/           # 核心逻辑 (bot, messages, spam, verification)
    ├── services/       # 外部服务 (DB, Telegram API, i18n)
    └── utils/          # 工具函数 / Helpers & utilities
```

---

## 🚀 部署指南 / Deployment Guide

> 本项目提供三种部署方式，选择最适合你的一种即可。  
> Three deployment methods are available — pick the one that fits your workflow.

| 方式 | Method | 适合场景 |
|------|--------|----------|
| ⭐ 方法一：Wrangler CLI | Local CLI Deploy | 初次部署，完整控制 |
| 🤖 方法二：GitHub Actions | CI/CD Auto-Deploy | 长期维护，推送即部署 |
| 🌐 方法三：CF Dashboard | Dashboard-Assisted | 无需本地环境，网页操作 |

---

### 🔖 前置准备（所有方法共用）/ Common Prerequisites

**获取 Bot Token / Get a Bot Token**

1. 打开 Telegram，搜索 [@BotFather](https://t.me/botfather)，发送 `/newbot`
2. 按提示输入名称和用户名，获得 **Bot Token**（格式：`123456:ABC...`）

**获取你的 Telegram UID / Get Your Telegram UID**

- 发消息给 [@userinfobot](https://t.me/userinfobot)，获取你的数字 **User ID**（如 `YOUR_ADMIN_UID`）

---

## 方法一：Wrangler CLI 本地部署（推荐初次部署）

> 适合：有本地开发环境，想完整掌控配置。  
> Best for: full control and initial setup.

### 第一步：安装 Wrangler 并登录

```bash
# 安装 Wrangler（全局）/ Install Wrangler globally
npm install -g wrangler

# 登录 Cloudflare 账号（会弹出浏览器页面，点 Allow 即可）
# Login to Cloudflare (browser will open, click Allow)
wrangler login
```

### 第二步：克隆项目并安装依赖

```bash
git clone https://github.com/levi4212/TgContactBot.git
cd TgContactBot
npm install
```

### 第三步：创建 D1 数据库

```bash
wrangler d1 create tgcontactbot
```

将输出的 `database_id` 复制进 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "tgcontactbot"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← 替换这里
```

然后推送数据库表结构：

```bash
wrangler d1 execute tgcontactbot --file=schema.sql --remote
```

### 第四步：设置密钥（Secrets）

> ⚠️ `ADMIN_UID` 等私密信息不要写进 `wrangler.toml`（防止公开仓库泄露隐私）！  
> Never write secrets into `wrangler.toml`!

```bash
echo "你的Telegram数字ID" | wrangler secret put ADMIN_UID
echo "你的BotToken" | wrangler secret put BOT_TOKEN
echo "任意随机字符串" | wrangler secret put BOT_SECRET
```

### 第五步：配置非敏感变量

编辑 `wrangler.toml`，修改 `[vars]` 中的其余项：

```toml
WELCOME_MESSAGE = "欢迎使用！"
```

### 第六步：部署

```bash
wrangler deploy
```

### 第七步：注册 Webhook

浏览器访问（替换为你的 Worker 域名）：

```
https://tgcontactbot.yourname.workers.dev/registerWebhook
```

返回 `"ok": true` 即表示成功 🎉

> 💡 以后更新代码只需 `wrangler deploy`，无需重新注册 Webhook。

---

## 方法二：GitHub Actions 自动化部署（推荐长期维护）

> 适合：代码托管在 GitHub，希望每次 `git push` 自动触发部署。  
> Best for: automated CI/CD — every push to `master` auto-deploys.

### 第一步：Fork 并配置仓库

Fork 本项目到你的 GitHub，然后在仓库的 **Settings → Secrets and variables → Actions** 中添加以下 Secret：

| Secret 名称 | 值 | 说明 |
|-------------|-----|------|
| `CF_API_TOKEN` | CF API Token | 前往 [CF Dashboard → API Tokens](https://dash.cloudflare.com/profile/api-tokens) 创建，选模板 **Edit Cloudflare Workers** |
| `CF_ACCOUNT_ID` | CF 账户 ID | CF Dashboard 右侧栏可找到 |
| `ADMIN_UID` | 你的 Telegram 数字 UID | ⭐ 重要：不能写进 wrangler.toml，否则公开仓库全世界可见 |
| `BOT_TOKEN` | 你的 Bot Token | Telegram BotFather 生成 |
| `BOT_SECRET` | 任意随机字符串 | Webhook 验证密钥 |

### 第二步：创建 D1 数据库和密钥（仅首次，二选一）

#### 选项 A：网页端操作（无需本地工具）✅ 推荐

**① 创建 D1 数据库**

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → 左侧菜单 → **D1 SQL Database**
2. 点击 **Create database**，命名为 `tgcontactbot`，点击 **Create**
3. 进入数据库详情页 → 点击 **Console** 标签
4. 将 `schema.sql` 的全部内容粘贴进去 → 点击 **Execute** 建表

**② 获取 database_id 并更新 wrangler.toml**

1. 在数据库详情页找到 **Database ID**（一串 UUID）
2. 打开你 Fork 的 GitHub 仓库，编辑 `wrangler.toml`，将 `database_id` 替换为你的值：

```toml
[[d1_databases]]
binding = "DB"
database_name = "tgcontactbot"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← 替换这里
```

**③ 设置密钥（Secrets）**

1. 前往 [CF Dashboard](https://dash.cloudflare.com) → **Workers & Pages → tgcontactbot**（如没有，先部署一次）
2. 点击 **Settings → Environment Variables**
3. 分别添加以下两个 **Secret 类型**（点击 Encrypt 按钮）：

| 名称 | 值 | 类型 |
|------|-----|------|
| `BOT_TOKEN` | 你的 Bot Token | 🔒 Secret |
| `BOT_SECRET` | 任意随机字符串 | 🔒 Secret |

> ⚠️ 注意：首次部署前 Worker 可能还不存在。可以先跳到第三步提交代码触发第一次部署，再回来设置 Secret。

---

#### 选项 B：本地 CLI 操作

```bash
npm install -g wrangler
wrangler login

# 创建数据库，将输出的 database_id 更新到 wrangler.toml
wrangler d1 create tgcontactbot

# 推送表结构
wrangler d1 execute tgcontactbot --file=schema.sql --remote

# 设置密钥
echo "你的BotToken" | wrangler secret put BOT_TOKEN
echo "随机字符串" | wrangler secret put BOT_SECRET
```

### 第三步：创建 GitHub Actions 工作流

在项目根目录创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [master]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          # 将 GitHub Secrets 注入为 Cloudflare Secrets（加密存储）
          secrets: |
            BOT_TOKEN
            BOT_SECRET
            ADMIN_UID
        env:
          BOT_TOKEN: ${{ secrets.BOT_TOKEN }}
          BOT_SECRET: ${{ secrets.BOT_SECRET }}
          ADMIN_UID: ${{ secrets.ADMIN_UID }}
```

> ✅ 这样所有敏感信息都存在 GitHub Secrets 中，wrangler.toml 里不包含任何私密数据，公开仓库完全安全。

### 第四步：触发首次部署

> ✅ `ADMIN_UID` / `BOT_TOKEN` / `BOT_SECRET` 已在 Step 1 的 GitHub Secrets 中配置，无需写入 wrangler.toml。

如需修改欢迎语等非敏感变量，可以编辑 `wrangler.toml` 的 `[vars]` 区块，然后提交：

**选项 A：网页端（无需本地工具）**

1. 打开你 Fork 的 GitHub 仓库，找到 `wrangler.toml`
2. 点击右上角铅笔 ✏️ 图标进入编辑
3. 修改 `WELCOME_MESSAGE` 等非敏感变量（`ADMIN_UID` 留空或保持默认占位符即可）
4. 页面底部点击 **Commit changes** — GitHub Actions 立即自动触发部署 🚀

**选项 B：本地 git**

```bash
git add .
git commit -m "feat: initial deploy config"
git push origin master
```

在仓库的 **Actions** 标签页可查看部署进度和日志。

### 第五步：注册 Webhook（仅首次）

```
https://tgcontactbot.yourname.workers.dev/registerWebhook
```

> 💡 之后每次 `git push` 都会自动重新部署，无需任何手动操作。

---

## 方法三：CF Dashboard 网页端控制台操作

> 适合：不想在本地安装任何工具，全程使用浏览器操作。  
> Best for: no local tools — everything done in the browser.

> ⚠️ 注意：此方法仍需要在某台有 Node.js 的机器上执行**一次**数据库初始化。  
> Note: D1 schema initialization still requires a one-time CLI run.

### 第一步：在 CF Dashboard 创建 Worker

1. 前往 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. 点击 **Create application → Create Worker**
3. 命名为 `tgcontactbot`，点击 **Deploy**

### 第二步：在 CF Dashboard 创建 D1 数据库

1. 左侧导航 → **D1 SQL Database → Create database**
2. 命名为 `tgcontactbot`，选择区域，点击 **Create**
3. 在数据库详情页 → **Console** 标签 → 粘贴 `schema.sql` 内容 → **Execute**

### 第三步：绑定数据库到 Worker

1. 进入 Worker `tgcontactbot` → **Settings → Bindings**
2. 点击 **Add binding → D1 Database**
3. Variable name 填 `DB`，选择刚创建的 `tgcontactbot` 数据库

### 第四步：设置密钥和变量

进入 Worker → **Settings → Environment Variables**：

| 类型 | 名称 | 值 |
|------|------|----|
| Secret（加密存储）🔒 | `BOT_TOKEN` | 你的 Bot Token |
| Secret（加密存储）🔒 | `BOT_SECRET` | 任意随机字符串 |
| Variable | `ADMIN_UID` | 你的 Telegram 数字 ID |
| Variable | `WELCOME_MESSAGE` | 欢迎语 |
| 其他变量... | 参考[配置说明](#-配置变量说明--configuration-variables) | |

### 第五步：上传代码（配合 GitHub Actions）

> ⚠️ 由于本项目含多个源代码文件，Cloudflare 网页编辑器不支持直接上传多文件项目。需本地打包后上传：

```bash
git clone https://github.com/levi4212/TgContactBot.git
cd TgContactBot
npm install
npx wrangler deploy   # 使用 wrangler 部署（需登录 CF），或将打包产物手动上传

建议直接使用 **方法二（GitHub Actions）** 自动上传代码。这样可以实现两全其美：在 CF 网页端建库和管理，在 GitHub 网页端自动打包发布。

### 第六步：注册 Webhook

浏览器访问：

```
https://tgcontactbot.yourname.workers.dev/registerWebhook
```

---

## 🔑 密钥说明 / Secrets Reference

在 **CF Dashboard → Secrets** 或用 `wrangler secret put` 设置，**不要写进代码**：  
Set via CF Dashboard or `wrangler secret put` — **never write these in code**:

| 变量名 | 说明 | 是否必填 |
|--------|------|---------|
| `BOT_TOKEN` | Telegram Bot Token（BotFather 生成） | ✅ 必填 |
| `BOT_SECRET` | Webhook 验证密钥，任意随机字符串 | ✅ 必填 |
| `EXPORT_SECRET` | 导出接口保护密钥（可选） | ❌ 可选 |

---

## ⚙️ 配置变量说明 / Configuration Variables

在 **CF Dashboard → Variables** 或 `wrangler.toml [vars]` 中设置：  
Set in CF Dashboard → Variables or in `wrangler.toml [vars]`:

### 必填 / Required

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ADMIN_UID` | — | Bot 所有者 Telegram 数字 ID |
| `ADMIN_GROUP_ID` | — | 管理群组 ID（群模式必填，私聊模式留空） |

### Bot 消息 / Bot Messages

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `WELCOME_MESSAGE` | `Welcome to use LeviFREE bot!` | 用户 /start 时显示的欢迎语 |
| `MAINTENANCE_MESSAGE` | `We are under maintenance...` | 维护模式提示语 |

### 验证 / Verification

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENABLE_VERIFICATION` | `true` | 是否开启新用户数学验证码 |
| `VERIFICATION_VALID_HOURS` | `2` | 验证通过后有效期（小时） |

### 营业时间 / Business Hours

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `BUSINESS_HOURS_START` | `09:00` | 上班时间（24小时制） |
| `BUSINESS_HOURS_END` | `22:00` | 下班时间（24小时制） |
| `BUSINESS_TIMEZONE` | `Asia/Shanghai` | 时区（[IANA 格式](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)） |

### 垃圾过滤 / Spam Filter

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENABLE_SPAM_FILTER` | `true` | 是否启用垃圾过滤 |
| `SPAM_KEYWORDS` | `操逼赚钱,...` | 本地关键词黑名单，逗号分隔，支持 `/regex/i` |
| `SPAM_BLOCKLIST_URL` | GitHub 链接 | 远程关键词黑名单 URL（每月自动刷新，可 `/refreshspam` 强制刷新） |
| `SPAM_ACTION` | `block` | 触发垃圾过滤后的动作：`block`（封禁）或 `delete`（仅删除） |
| `DELETE_SPAM_MESSAGE` | `true` | 检测到垃圾后是否删除消息 |
| `GROUP_SPAM_DETECTION` | `true` | 是否在管理群组内也检测垃圾 |
| `GROUP_SPAM_ACTION` | `ban` | 群组垃圾处理方式：`ban` 或 `kick` |

### 防刷屏 / Anti-Flood

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ANTI_FLOOD_MESSAGES` | `5` | 时间窗口内最多发多少条消息 |
| `ANTI_FLOOD_SECONDS` | `5` | 时间窗口大小（秒） |

### 日志与话题 / Logs & Topics

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENV_LOG_RETENTION_DAYS` | `7` | 消息日志保留天数（0 = 不清理） |
| `AUTO_CLOSE_INACTIVE_HOURS` | `72` | 话题无活动多少小时后自动关闭 |
| `DELETE_TOPIC_AS_BAN` | `false` | 删除话题是否等同封禁用户 |

### 广播 / Broadcast

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `MAX_BROADCAST_BATCH` | `50` | 广播每批发送数量 |

### 高级 / Advanced

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ADMINS` | — | 额外管理员 UID，逗号分隔（如 `uid1,uid2`） |
| `WHITELIST_URL` | — | 远程白名单 URL（自动跳过验证） |
| `SECURITY_DB_URL` | — | 外部安全黑名单 URL |
| `ENABLE_NOTIFICATION` | `false` | 新用户发消息时是否推送 UID 通知 |

---

## � 命令列表 / Command Reference

### 用户命令 / User Commands

| 命令 | 说明 |
|------|------|
| `/start` | 开始使用 / Start the bot |

### 管理员命令 / Admin Commands

> 仅 `ADMIN_UID`、`ADMINS` 中配置的 UID，或管理群组的群管理员可使用。  
> Only the owner (`ADMIN_UID`), additional admins (`ADMINS`), or group admins can use these.

**🔒 用户管理 / User Management**

| 命令 | 说明 |
|------|------|
| `/block <id>` 或回复 | 永久封禁用户 / Block a user |
| `/ban <id>` 或回复 | 封禁（同 /block）/ Alias for /block |
| `/unblock <id>` 或回复 | 解封用户 / Unblock a user |
| `/unban <id>` 或回复 | 解封（同 /unblock）/ Alias for /unblock |
| `/checkblock <id>` 或回复 | 查看封禁状态 / Check block status |
| `/white` 回复用户消息 | 快速加入白名单 / Quick whitelist |
| `/unwhite` 回复用户消息 | 快速移出白名单 / Quick remove from whitelist |
| `/whitelist add <id>` | 加入白名单 / Add to whitelist |
| `/whitelist remove <id>` | 移出白名单 / Remove from whitelist |
| `/whitelist list` | 查看白名单列表 / View whitelist |

**📊 信息查询 / Info & Stats**

| 命令 | 说明 |
|------|------|
| `/uid` 或回复 | 获取用户 Telegram ID |
| `/userinfo` 或回复 | 查看用户详情 |
| `/stats` | Bot 统计信息（用户数、消息数、拦截数） |
| `/listadmins` | 查看所有管理员 |

**🗂️ 话题管理 / Topic Management**

| 命令 | 说明 |
|------|------|
| `/clear` | 清除今日日志（话题内） |
| `/close` | 关闭当前话题 |
| `/reopen` | 重新开启话题 |

**📣 广播与模板 / Broadcast & Templates**

| 命令 | 说明 |
|------|------|
| `/broadcast <内容>` | 向所有用户广播消息 |
| `/tpl add <键> <内容>` | 添加快捷回复模板 |
| `/tpl del <键>` | 删除模板 |
| `/tpl list` | 查看所有模板 |
| `/tpl <键>` | 发送模板内容 |

**🔧 系统管理 / System**

| 命令 | 说明 |
|------|------|
| `/maintenance on` | 开启维护模式（用户收到维护提示） |
| `/maintenance off` | 关闭维护模式 |
| `/addspam <关键词>` | 添加垃圾关键词 |
| `/removespam <关键词>` | 删除垃圾关键词 |
| `/listspam` | 查看垃圾关键词数量 |
| `/spamstats` | 垃圾拦截统计 |
| `/refreshspam` | 立即从远程 URL 刷新关键词黑名单 |
| `/lang` | 切换管理员界面语言（中文/English）|
| `/help` | 查看命令帮助 |

---

## 🌐 常用端点 / Useful Endpoints

| 地址 | 说明 |
|------|------|
| `/registerWebhook` | 注册 Telegram Webhook（部署后访问一次） |
| `/unRegisterWebhook` | 注销 Webhook |
| `/health` | 健康检查，返回运行状态 |

---

## ❓ 常见问题 / FAQ

**Q: 部署后机器人没有回复？**  
A: 确认是否已访问 `/registerWebhook` 注册 Webhook，以及 `BOT_TOKEN` 密钥是否正确设置。

**Q: 忘记设置 BOT_SECRET 导致请求全部 403？**  
A: 用 `wrangler secret put BOT_SECRET` 重新设置，然后重新访问 `/registerWebhook`。

**Q: 如何更换 Bot Token？**  
A: `echo "新Token" | wrangler secret put BOT_TOKEN`，然后重新访问 `/registerWebhook`。

**Q: 如何查看实时日志？**  
A: 运行 `wrangler tail` 可实时查看 Worker 日志。

**Q: 如何重置数据库？**  
A: 重新执行 `wrangler d1 execute tgcontactbot --file=schema.sql --remote`（⚠️ 会清空所有数据！）

---

*Powered by Cloudflare Workers + D1 · Built for reliability and speed*
