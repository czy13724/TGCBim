# TgContactBot

TgContactBot is an advanced, high-performance Telegram Contact Bot deployed on **Cloudflare Workers**. It utilizes **Cloudflare D1** (Serverless SQLite) for ultra-fast, structured data storage and supports enterprise-level features including anti-spam, automated business hours, and interactive user verification.

这是一个部署在 **Cloudflare Workers** 上的高性能 Telegram 留言板机器人。它依托于 **Cloudflare D1** (Serverless SQLite) 数据库实现超快的结构化数据存储，并支持企业级功能（如防刷屏、自动上下班回复、验证码防护等）。

---

## ✨ Features (功能特性)

- **Zero-Server Deployment:** Runs 100% on Cloudflare Workers edge network.
- **D1 Database:** Robust SQLite database replacing the older, limit-prone KV system.
- **Two-Step Human Verification:** Protects against bot spam with dynamic mathematical CAPTCHAs and clickable inline buttons. 🛡️
- **Auto-Translate:** Integrates with Google Translate API to translate incoming messages. 🌍
- **Anti-Flood Rate Limiting:** Prevent users from spamming the admin uncontrollably.
- **Business Hours Auto-Reply:** Automatically send your customers a "We are currently offline" message outside of configured working hours. 💤
- **Admin Quick Actions:** Inline buttons (`Ban User`, `Whitelist`) attached directly to user messages for fast moderation.
- **Bilingual Interface (i18n):** Bot UI switches automatically matching the user's Telegram language, or via manual language selection (`English`/`中文`).

---

## 📂 Project Structure (项目结构)

This repository follows a professional, modular architecture pattern:

```text
TgContactBot/
├── README.md               # User documentation
├── schema.sql              # Database schema definition
├── index.js                # Default worker export wrapper
├── wrangler.toml           # Cloudflare deployment configuration
├── D1_MIGRATION_GUIDE.md   # Migration docs (Legacy KV -> D1)
└── src/
    ├── index.js            # Main Cloudflare Worker entry point
    ├── config.js           # Configuration and environment variables
    ├── commands/           # Bot commands handlers (/start, /ban, etc)
    ├── core/               # Core bot logic (routing, verification, spam logic)
    ├── services/           # External service integrations (D1 DB, Telegram API, i18n)
    └── utils/              # Shared utilities and reusable helpers
```

---

## 🚀 Deployment (详细部署指南)

请按照以下步骤，从零开始将机器人部署到 Cloudflare 上。

### 1. 准备工作：获取 Bot Token 和 管理员 ID
1. 在 Telegram 中搜索并进入 [@BotFather](https://t.me/botfather)。
2. 发送 `/newbot` 指令，按照提示输入你的机器人名称（Name）和用户名（Username）。
3. BotFather 会生成一段 **Bot Token**（例如 `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`），请妥善保存。
4. 搜索进入 [@userinfobot](https://t.me/userinfobot) 或任何能获取 ID 的机器人，发送任意消息，获取你的 **Telegram UID**（一串数字，如 `123456789`）。

### 2. 环境搭建：安装 Wrangler 并登录 Cloudflare
请确保你的电脑已经安装了 [Node.js](https://nodejs.org/)。
1. 打开终端（Terminal），全局安装 Cloudflare 的命令行工具 Wrangler：
   ```bash
   npm install -g wrangler
   ```
2. 登录你的 Cloudflare 账号：
   ```bash
   wrangler login
   ```
   *这会自动在浏览器中弹出一个页面，点击“Allow”授权登录即可。*

### 3. 构建数据库 (Cloudflare D1)
由于本作使用了强大的 SQLite 无服务器数据库 D1，你需要先在云端创建它。
1. 在终端运行以下命令创建一个名为 `TGBOT` 的数据库：
   ```bash
   wrangler d1 create TGBOT
   ```
2. 命令运行成功后，终端会输出一段类似于以下的代码块：
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "TGBOT"
   database_id = "xxxx-xxxx-xxxx-xxxx"
   ```
   **请将这段代码直接复制并替换掉你本目录下 `wrangler.toml` 文件中对应的 `[[d1_databases]]` 区域。**
3. 将项目自带的数据库表结构（Schema）推送到刚刚建好的线上数据库中：
   ```bash
   wrangler d1 execute TGBOT --file=schema.sql --remote
   ```
   *(如果遇到报错可用 `--local` 选项先进行本地测试。)*

### 4. 配置环境变量
打开项目根目录下的 `wrangler.toml` 文件，找到 `[vars]` 区域，将刚才获取到的配置信息填入：
```toml
[vars]
# 你的 Telegram Bot Token
BOT_TOKEN = "YOUR_BOT_TOKEN_HERE"
# 你的 Telegram 数字 ID
ADMIN_UID = "YOUR_TELEGRAM_ADMIN_ID"
# 用于校验 Webhook 请求安全性的随机通信密钥（建议随便敲一串长字母和数字的组合）
BOT_SECRET = "RANDOM_STRONG_STRING"

# 自动下班回复功能配置（根据需要修改，24小时制）
BUSINESS_HOURS_START = "09:00"
BUSINESS_HOURS_END = "22:00"
BUSINESS_TIMEZONE = "Asia/Shanghai" # 时区
```

### 5. 发布部署
执行以下命令，将代码免费部署到 Cloudflare 的全球边缘节点：
```bash
wrangler deploy
```
*部署成功后，终端会显示你的 Worker 网络地址，例如：`https://tgcontactbot.yourname.workers.dev`*

### 6. 激活 Webhook（极其重要！）
如果你不激活 Webhook，Telegram 就不知道要把用户发来的消息传输给 Cloudflare。
1. 复制你刚才部署成功得到的域名地址（结尾带 `.workers.dev` 或你的自定义域名）。
2. 在地址后面加上 `/registerWebhook`，在浏览器的地址栏中访问它。
   
   例如：在你电脑浏览器输入并访问：  
   👉 `https://tgcontactbot.yourname.workers.dev/registerWebhook`

3. 如果页面返回了一段包含 `"ok": true, "result": true` 的 JSON 数据，就说明 Webhook 绑定成功！恭喜！你现在可以去 Telegram 和你的机器人说话了。

---

## 🔧 User Commands (用户命令)
- `/start` - Start the bot.

## 👑 Admin Commands (管理员命令)
Only the configured `ADMIN_UID` or Group Admins can execute these.
- `/block <id>` (or reply) - Block a user permanently.
- `/unblock <id>` (or reply) - Restore a user.
- `/whitelist add <id>` - Skip CAPTCHA for a specific user.
- `/uid @username` (or reply) - Extract a user's Telegram ID.
- `/stats` - View total users, messages, and spam blocks.
- `/addspam <keyword>` - Blacklist a word or regex pattern (messages containing it will be dropped).
- `/broadcast <text>` - Send a mass message to all previously interacted users.

---
*Created by the TgContactBot Open Source Community.*
