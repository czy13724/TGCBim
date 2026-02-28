/**
 * Basic Commands (Start, Help, Stats)
 * 基本命令（开始、帮助、统计）
 */
import { config, isGlobalAdminOrOwner } from '../config.js';
import { db, tplGet } from '../services/db.js';
import { sendMessage, getMe } from '../services/telegram.js';
import { escapeHtml } from '../utils/utils.js';
import { checkSecurity, updateUserDb } from '../utils/helpers.js';

export async function handleStart(message) {
    const user = message.from

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
    // 在 KV 中检查自定义开始消息
    let startMsg = await tplGet('start')
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

    let text = startMsg || `👋 Hi ${escapeHtml(user.first_name)}! Welcome to ${escapeHtml(botName)}.\n\nSend me a message and I will forward it to the admin.`

    await sendMessage({
        chat_id: message.chat.id,
        text: text,
        parse_mode: 'HTML'
    })
}

export async function handleHelpCommand(message) {
    // Determine if admin
    // 确定是否为管理员
    const isAdmin = isGlobalAdminOrOwner(message.from.id)

    let text = `🤖 <b>Bot Help</b>\n\n`

    if (isAdmin) {
        text += `<b>Admin Commands:</b>\n`
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
        text += `/clear - Clear today's log (in topic)\n`
        text += `/close - Close topic\n`
        text += `/reopen - Reopen topic\n`
        text += `/tpl add|del|list|&lt;key&gt; - Template management\n`
        text += `/spamstats - Spam statistics\n`
        text += `/listspam - List spam keywords\n`
        text += `/addspam &lt;kw&gt; - Add spam keyword\n`
        text += `/removespam &lt;kw&gt; - Remove spam keyword\n`
        text += `/maintenance &lt;on/off&gt; - Toggle maintenance mode\n`
        text += `/listadmins - List all admins\n`
    } else {
        text += `Send messages to contact support.\n`
    }

    await sendMessage({
        chat_id: message.chat.id,
        text: text,
        parse_mode: 'HTML'
    })
}

export async function handleStatsCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return

    const totalMessages = await db.getCounter('total_messages')
    const users = await db.getAllUsers(10000)
    const userCount = users.length
    const blockedCount = await db.getCounter('spam_blocked')

    const maint = await db.getCounter('maintenance_mode')

    let text = `📊 <b>Statistics</b>\n\n`
    text += `👤 <b>Users:</b> ${userCount}\n`
    text += `🚫 <b>Spam Blocked:</b> ${blockedCount}\n`
    text += `📨 <b>Messages:</b> ${totalMessages}\n`
    text += `🛠 <b>Maintenance:</b> ${maint === 1 ? 'ON' : 'OFF'}\n`

    await sendMessage({
        chat_id: message.chat.id,
        text: text,
        parse_mode: 'HTML'
    })
}
