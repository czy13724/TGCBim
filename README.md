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

### 第一步：准备工作 / Step 1: Prerequisites

**1.1 创建 Telegram Bot / Create a Telegram Bot**

1. 打开 Telegram，搜索 [@BotFather](https://t.me/botfather)
2. 发送 `/newbot`，按提示输入机器人名称和用户名
3. BotFather 会返回你的 **Bot Token**，格式如：`123456789:AAFxxx...`，妥善保存

**1.2 获取你的 Telegram UID / Get Your Telegram UID**

- 发消息给 [@userinfobot](https://t.me/userinfobot)，它会回复你的数字 **User ID**（如 `YOUR_ADMIN_UID`）

**1.3 安装 Node.js / Install Node.js**

- 前往 [nodejs.org](https://nodejs.org) 下载安装，选 LTS 版本即可

---

### 第二步：安装 Wrangler 并登录 / Step 2: Install Wrangler & Login

```bash
# 安装 Wrangler（全局）/ Install Wrangler globally
npm install -g wrangler

# 登录 Cloudflare 账号（会弹出浏览器页面，点 Allow 即可）
# Login to Cloudflare (browser will open, click Allow)
wrangler login
```

---

### 第三步：克隆项目 / Step 3: Clone the Project

```bash
git clone https://github.com/levi4212/TgContactBot.git
cd TgContactBot
npm install
```

---

### 第四步：创建 D1 数据库 / Step 4: Create D1 Database

```bash
# 创建数据库 / Create the database
wrangler d1 create tgcontactbot
```

命令成功后会输出类似内容 / The output will look like:

```toml
[[d1_databases]]
binding = "DB"
database_name = "tgcontactbot"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  ← 复制这个
```

> ⚠️ **将 `database_id` 替换进 `wrangler.toml` 对应位置！**  
> Replace the `database_id` in your `wrangler.toml` file.

然后推送数据库表结构 / Then apply the schema:

```bash
wrangler d1 execute tgcontactbot --file=schema.sql --remote
```

---

### 第五步：配置密钥（Secrets）/ Step 5: Set Secrets

> ⚠️ 密钥**不要**写进 `wrangler.toml`（会上传到 GitHub！）  
> Secrets must **NOT** be written in `wrangler.toml` (they'd be exposed on GitHub!)

通过命令行将密钥安全地上传到 Cloudflare / Upload secrets securely via CLI:

```bash
# Bot Token（必填 / Required）
echo "你的Bot Token" | wrangler secret put BOT_TOKEN

# Webhook 验证密钥，随机字符串即可（必填 / Required）
# Any random string, e.g. a UUID or long password
echo "随机字符串" | wrangler secret put BOT_SECRET
```

也可以在 **CF Dashboard → Workers → tgcontactbot → Settings → Secrets** 里手动添加。  
Or add them manually in **CF Dashboard → Workers → tgcontactbot → Settings → Secrets**.

---

### 第六步：配置变量 / Step 6: Configure Variables

打开 `wrangler.toml`，修改 `[vars]` 区块中的必填项：  
Open `wrangler.toml` and update the required values in the `[vars]` section:

```toml
[vars]
ADMIN_UID = "你的Telegram数字ID"  # 必填 / Required
WELCOME_MESSAGE = "你的欢迎语"    # 可选，建议修改 / Recommended
```

其他变量均已有默认值，按需修改（详见下方[完整变量说明](#-配置变量说明--configuration-variables)）。  
All other variables have defaults and can be left as-is or tuned later.

---

### 第七步：部署 / Step 7: Deploy

```bash
wrangler deploy
```

部署成功后会输出你的 Worker 地址，如：  
On success you'll see your Worker URL, e.g.:

```
https://tgcontactbot.yourname.workers.dev
```

---

### 第八步：注册 Webhook / Step 8: Register Webhook

在浏览器中访问以下地址（将域名替换为你自己的）：  
Visit this URL in your browser (replace with your worker URL):

```
https://tgcontactbot.yourname.workers.dev/registerWebhook
```

如果返回 `"ok": true, "result": true`，说明 Webhook 注册成功！  
If you see `"ok": true, "result": true`, the webhook is active — you're done! 🎉

> 💡 以后更新代码只需重新运行 `wrangler deploy` 即可，无需再次注册 Webhook。  
> Future updates only need `wrangler deploy` — no need to re-register the webhook.

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
