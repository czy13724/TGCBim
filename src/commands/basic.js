/**
 * Basic Commands (Start, Help, Stats)
 * 基本命令（开始、帮助、统计）
 */
import { config, isGlobalAdminOrOwner } from '../config.js';
import { db, tplGet } from '../services/db.js';
import { sendMessage, getMe } from '../services/telegram.js';
import { escapeHtml } from '../utils/utils.js';
import { checkSecurity, updateUserDb } from '../utils/helpers.js';
import { getLang, t } from '../services/i18n.js';

export async function handleStart(message) {
    const user = message.from
    const dbUser = await db.getUser(user.id).catch(() => null)
    const savedLang = await db.getUserState(user.id, 'user_pref_lang').catch(() => null)
    const lang = savedLang === 'zh' || savedLang === 'en' ? savedLang : getLang(dbUser || user)

    // Check security first
    // 先检查安全
    const securityCheck = await checkSecurity(user.id)
    if (securityCheck.blocked) {
        return // Silently ignore
        // 默默忽略
    }

    // Update user stats
    // 更新用户统计信息
    await updateUserDb(user)

    // If start parameter (deep linking)
    // 如果存在开始参数（深度链接）
    const args = message.text.split(' ')
    if (args.length > 1) {
        // Handle deep link logic if any
        // 处理深度链接逻辑（如果有）
    }

    // Check for custom start message in KV
    // 在 KV 中检查自定义开始消息（优先语言版本）
    let startMsg = await tplGet(`start_${lang}`)
    if (!startMsg) startMsg = await tplGet('start')
    if (!startMsg) {
        startMsg = config.WELCOME_MESSAGE
    }

    // If configured external URL for start message
    // 如果为开始消息配置了外部 URL
    if (config.START_MSG_URL && !startMsg) {
        try {
            const resp = await fetch(config.START_MSG_URL)
            startMsg = await resp.text()
        } catch (e) { }
    }

    const botInfo = await getMe()
    const botName = botInfo.result ? botInfo.result.first_name : 'Bot'

    let text = startMsg || t('start_fallback', lang, {
        NAME: escapeHtml(user.first_name || 'User'),
        BOT: escapeHtml(botName)
    })

    await sendMessage({
        chat_id: message.chat.id,
        text: text,
        parse_mode: 'HTML'
    })
}

export async function handleHelpCommand(message) {
    const isAdmin = isGlobalAdminOrOwner(message.from.id)
    const dbUser = isAdmin ? await db.getUser(message.from.id).catch(() => null) : null
    const lang = getLang(dbUser || message.from)
    const zh = lang === 'zh'

    let text = zh ? `🤖 <b>Bot 帮助</b>\n\n` : `🤖 <b>Bot Help</b>\n\n`

    if (isAdmin) {
        text += zh ? `<b>管理员命令：</b>\n` : `<b>Admin Commands:</b>\n`
        if (zh) {
            text += `/block 或 /ban - 封禁用户（回复或 /block &lt;id&gt;）\n`
            text += `/unblock 或 /unban - 解封用户\n`
            text += `/checkblock - 查看封禁状态\n`
            text += `/white - 加入白名单（回复用户消息）\n`
            text += `/unwhite - 移出白名单（回复）\n`
            text += `/whitelist add|remove|list - 白名单管理\n`
            text += `/uid - 获取用户 ID（回复或 /@用户名）\n`
            text += `/userinfo - 查看用户信息（回复或话题中）\n`
            text += `/stats - Bot 统计信息\n`
            text += `/broadcast - 向所有用户广播消息\n`
            text += `/clear - 清除指定用户历史（回复/话题/ID）\n`
            text += `/tpl add|del|list|&lt;键&gt; - 模板管理\n`
            text += `/spamstats - 垃圾拦截统计\n`
            text += `/listspam - 查看垃圾关键词列表\n`
            text += `/addspam &lt;关键词&gt; - 添加垃圾关键词\n`
            text += `/removespam &lt;关键词&gt; - 删除垃圾关键词\n`
            text += `/maintenance - 维护模式面板（按钮开关）\n`
            text += `/listadmins - 查看所有管理员\n`
            text += `/addadmin /removeadmin - 增删动态管理员（仅所有者）\n`
            text += `/refreshspam - 强制刷新远程关键词列表\n`
            text += `/audit [页码] - 查看最近管理员操作日志\n`
            text += `/lang - 切换管理员界面语言\n`
            text += `\n🛡 SAFE_MODE 开启时，高风险命令仅所有者可用。\n`
        } else {
            text += `/block <i>or</i> /ban - Block user (reply or /block &lt;id&gt;)\n`
            text += `/unblock <i>or</i> /unban - Unblock user\n`
            text += `/checkblock - Check block status\n`
            text += `/white - Add to whitelist (reply to user message)\n`
            text += `/unwhite - Remove from whitelist (reply)\n`
            text += `/whitelist add|remove|list - Full whitelist management\n`
            text += `/uid - Get user ID (reply or /@username)\n`
            text += `/userinfo - Get user info (reply or in topic)\n`
            text += `/stats - Bot statistics\n`
            text += `/broadcast - Broadcast message to all users\n`
            text += `/clear - Clear target user history (reply/topic/id)\n`
            text += `/tpl add|del|list|&lt;key&gt; - Template management\n`
            text += `/spamstats - Spam statistics\n`
            text += `/listspam - List spam keywords\n`
            text += `/addspam &lt;kw&gt; - Add spam keyword\n`
            text += `/removespam &lt;kw&gt; - Remove spam keyword\n`
            text += `/maintenance - Maintenance panel (button toggle)\n`
            text += `/listadmins - List all admins\n`
            text += `/addadmin /removeadmin - Manage dynamic admins (owner only)\n`
            text += `/refreshspam - Force refresh remote spam blocklist\n`
            text += `/audit [page] - Show recent admin audit logs\n`
            text += `/lang - Switch admin interface language\n`
            text += `\n🛡 When SAFE_MODE is enabled, high-risk commands are owner-only.\n`
        }
    } else {
        text += zh ? `发送消息即可联系客服。\n` : `Send messages to contact support.\n`
    }

    await sendMessage({ chat_id: message.chat.id, text, parse_mode: 'HTML' })
}

export async function handleStatsCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return

    const dbUser = await db.getUser(message.from.id).catch(() => null)
    const lang = getLang(dbUser || message.from)
    const zh = lang === 'zh'

    const totalMessages = await db.getCounter('total_messages')
    const users = await db.getAllUsers(10000)
    const userCount = users.length
    const blockedCount = await db.getCounter('spam_blocked')
    const maint = await db.getCounter('maintenance_mode')

    let text = zh ? `📊 <b>统计信息</b>\n\n` : `📊 <b>Statistics</b>\n\n`
    text += zh
        ? `👤 <b>用户数：</b> ${userCount}\n🚫 <b>已拦截垃圾：</b> ${blockedCount}\n📨 <b>消息总数：</b> ${totalMessages}\n🛠 <b>维护模式：</b> ${maint === 1 ? '开启' : '关闭'}\n`
        : `👤 <b>Users:</b> ${userCount}\n🚫 <b>Spam Blocked:</b> ${blockedCount}\n📨 <b>Messages:</b> ${totalMessages}\n🛠 <b>Maintenance:</b> ${maint === 1 ? 'ON' : 'OFF'}\n`

    await sendMessage({ chat_id: message.chat.id, text, parse_mode: 'HTML' })
}
