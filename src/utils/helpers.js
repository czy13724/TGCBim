/**
 * Helper functions
 * 辅助函数
 */
import { config } from '../config.js';
import { db, d1 } from '../services/db.js';
import { sendMessage, deleteMessage, sendPhoto, getUserProfilePhotos, closeForumTopic, getBotInfo } from '../services/telegram.js';
import { escapeHtml, delay, formatTime, isBusinessHours } from './utils.js';
import { getLang, t } from '../services/i18n.js';

export async function checkSecurity(id) {
    try {
        id = id.toString()

        // Check custom security database if configured
        // 如果配置了自定义安全数据库，则进行检查
        if (config.SECURITY_DB_URL) {
            const response = await fetch(config.SECURITY_DB_URL)
            const data = await response.text()
            const entries = data.split('\n').filter(v => v.trim())

            if (entries.includes(id)) {
                console.log(`Security check: ${id} found in custom database`)
                return { blocked: true, reason: 'security_database' }
            }
        }
        return { blocked: false, reason: null }
    } catch (error) {
        console.error('Error checking security database:', error)
        return { blocked: false, reason: null }
    }
}

export async function updateUserDb(user) {
    try {
        const existingUser = await db.getUser(user.id)
        if (existingUser) {
            existingUser.first_name = user.first_name || 'Unknown'
            existingUser.last_name = user.last_name
            existingUser.username = user.username
            existingUser.updated_at = Date.now()
            existingUser.message_count = (existingUser.message_count || 0) + 1
            existingUser.last_activity = Date.now()
            await db.setUser(user.id, existingUser)
        } else {
            const newUser = {
                user_id: user.id,
                first_name: user.first_name || 'Unknown',
                last_name: user.last_name,
                username: user.username,
                language_code: user.language_code || 'en',
                message_thread_id: null,
                message_count: 1,
                created_at: Date.now(),
                updated_at: Date.now(),
                last_activity: Date.now()
            }
            await db.setUser(user.id, newUser)
            await db.incrementCounter('new_users_today')
        }

        await db.incrementCounter('total_messages')

        // Probabilistic log retention cleanup
        // 概率性日志保留清理
        const retentionDays = config.ENV_LOG_RETENTION_DAYS || 0
        if (retentionDays > 0 && Math.random() < 0.02) {
            try {
                const cutoffTimeMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
                const delStmt = d1.prepare("DELETE FROM message_logs WHERE user_id = ? AND created_at < ?");
                await delStmt.bind(user.id.toString(), cutoffTimeMs).run();
            } catch (e) {
                console.error('Log retention cleanup error:', e)
            }
        }

    } catch (error) {
        console.error('Error updating user database:', error)

        if (isKVWriteLimitError(error)) {
            const user_data = await db.getUser(user.id).catch(() => null)
            const message_thread_id = user_data?.message_thread_id || null
            await handleKVLimitError(user, message_thread_id)
        }

        throw error
    }
}

export async function sendContactCard(chat_id, message_thread_id, user) {
    console.log(`Sending contact card for user ${user.id}`)

    try {
        const userData = await db.getUser(user.id)
        let contactText = `👤 <b>${escapeHtml(user.first_name || user.id)}</b>`

        if (user.last_name) {
            contactText += ` ${escapeHtml(user.last_name)}`
        }

        contactText += `\n\n📱 <b>User ID:</b> <code>${user.id}</code>`

        if (user.username) {
            contactText += `\n🔗 <b>Username:</b> @${user.username}`
            contactText += `\n📞 <b>Contact:</b> @${user.username}`
        } else {
            contactText += `\n📞 <b>Contact:</b> <a href="tg://user?id=${user.id}">Direct Link</a>`
        }

        if (userData) {
            contactText += `\n📊 <b>Messages:</b> ${userData.message_count || 1}`
            contactText += `\n🕐 <b>Joined:</b> ${formatTime(userData.created_at)}`
            contactText += `\n⏰ <b>Last Active:</b> ${formatTime(userData.last_activity)}`

            if (userData.language_code) {
                contactText += `\n🌐 <b>Language:</b> ${userData.language_code}`
            }
        }

        const inline_keyboard = [
            [
                { text: '🚫 Ban User', callback_data: `admin:ban:${user.id}` },
                { text: '✨ Whitelist', callback_data: `admin:whitelist:${user.id}` }
            ]
        ]

        const userPhotos = await getUserProfilePhotos(user.id)

        if (userPhotos.ok && userPhotos.result && userPhotos.result.total_count > 0) {
            const pic = userPhotos.result.photos[0][userPhotos.result.photos[0].length - 1].file_id

            const result = await sendPhoto({
                chat_id: chat_id,
                message_thread_id: message_thread_id,
                photo: pic,
                caption: contactText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard }
            })

            return result
        } else {
            const result = await sendMessage({
                chat_id: chat_id,
                message_thread_id: message_thread_id,
                text: contactText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard }
            })

            return result
        }
    } catch (error) {
        console.error('Failed to send contact card:', error)
        return { ok: false, error: error.message }
    }
}

export async function maybeSendDeliveredNotice(sender_user_id, target_chat_id, userObj, options = {}) {
    // If text isn't provided, use the localized default text
    let dbUser = null;
    try {
        dbUser = await db.getUser(sender_user_id);
    } catch (e) { }

    const lang = getLang(dbUser || userObj);
    const textStr = options.text || t('msg_delivered', lang);

    const { message_thread_id = null, reply_to_message_id = null, text = textStr } = options

    try {
        const today = new Date().toDateString()
        const stateKey = 'delivered_notice'
        const lastDate = await db.getUserState(sender_user_id, stateKey)

        // Check Business Hours to override standard notice
        let isOffline = !isBusinessHours(config.BUSINESS_HOURS_START, config.BUSINESS_HOURS_END, config.BUSINESS_TIMEZONE);
        let finalText = text;

        if (isOffline) {
            // Once per day offline notice
            if (lastDate === `offline_${today}`) return;
            finalText = t('msg_offline_auto_reply', lang);
        } else {
            // Once per day standard notice
            if (lastDate === today) return;
        }

        const params = { chat_id: target_chat_id, text: finalText }
        if (message_thread_id) params.message_thread_id = message_thread_id
        if (reply_to_message_id) params.reply_to_message_id = reply_to_message_id

        const sent = await sendMessage(params)
        if (sent && sent.ok) {
            await db.setUserState(sender_user_id, stateKey, isOffline ? `offline_${today}` : today)

            // Delete standard delivery notice after 3s, but keep offline notices so users know
            if (!isOffline) {
                await delay(3000)
                try {
                    await deleteMessage(target_chat_id, sent.result.message_id)
                } catch (e) {
                    console.error('Failed to delete delivered notice:', e)
                }
            }
        }
    } catch (e) {
        console.error('maybeSendDeliveredNotice error:', e)
    }
}

export function isKVWriteLimitError(error) {
    const errorMessage = (error.message || '').toLowerCase()
    return errorMessage.includes('kv put() limit exceeded') ||
        errorMessage.includes('kv write limit') ||
        errorMessage.includes('quota exceeded')
}

export async function handleKVLimitError(user, message_thread_id) {
    const user_id = user.id
    const userDisplayName = user.first_name || 'User'

    try {
        let alertText = `🚨 <b>KV Storage Limit Alert</b>\n\n` +
            `⚠️ Cloudflare KV daily write limit reached!\n\n` +
            `👤 <b>User Info:</b>\n` +
            `• Name: ${escapeHtml(userDisplayName)}\n` +
            `• Username: @${user.username || 'None'}\n` +
            `• Telegram ID: <code>${user_id}</code>\n`

        if (!user.username) {
            alertText += `• Direct Contact: tg://user?id=${user_id}\n`
        }

        if (message_thread_id) {
            alertText += `• Topic ID: ${message_thread_id}\n`
            alertText += `• Status: Has topic, message cannot be forwarded\n\n`
        } else {
            alertText += `• Status: No topic created, cannot create new topic\n\n`
        }

        alertText += `📋 <b>Impact:</b>\n` +
            `• Cannot create new topics\n` +
            `• Cannot update user data\n` +
            `• Cannot forward user messages\n\n` +
            `🔧 <b>Suggestions:</b>\n` +
            `• Wait for UTC time reset (usually daily 00:00)\n` +
            `• Consider upgrading Cloudflare plan\n` +
            `• Check for abnormal write operations\n\n` +
            `⏰ Time: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}`

        await sendMessage({
            chat_id: config.ADMIN_UID,
            text: alertText,
            parse_mode: 'HTML'
        })

        let dbUser = null;
        try {
            dbUser = await db.getUser(user_id);
        } catch (e) { }

        await sendMessage({
            chat_id: user_id,
            text: t('kv_limit_msg', getLang(dbUser || user))
        })

        console.log(`KV limit error handled for user ${user_id}, topic: ${message_thread_id || 'none'}`)

    } catch (alertError) {
        console.error('Failed to handle KV limit error:', alertError)
    }
}

export async function handleNotify(message) {
    let chatId = message.chat.id

    // Check security first
    // 先检查安全
    const securityCheck = await checkSecurity(chatId)
    if (securityCheck.blocked) {
        return sendMessage({
            chat_id: config.ADMIN_UID,
            text: `🛡️ Security Alert: Blocked user ${chatId} (Reason: ${securityCheck.reason})`
        })
    }

    if (config.ENABLE_NOTIFICATION) {
        let lastMsgTime = await db.getLastMessageTime(chatId)
        if (!lastMsgTime || Date.now() - lastMsgTime > config.NOTIFY_INTERVAL) {
            await db.setLastMessageTime(chatId, Date.now())
            try {
                let notificationText = `🔔 New user message notification - UID: ${chatId}`
                if (config.NOTIFICATION_URL) {
                    const response = await fetch(config.NOTIFICATION_URL)
                    notificationText = await response.text()
                }
                return sendMessage({
                    chat_id: config.ADMIN_UID,
                    text: notificationText
                })
            } catch (e) {
                console.error('Failed to fetch notification text:', e)
                return sendMessage({
                    chat_id: config.ADMIN_UID,
                    text: `🔔 New user message notification - UID: ${chatId}`
                })
            }
        }
    }
}

export async function checkInactiveTopics() {
    if (!config.ADMIN_GROUP_ID || !config.AUTO_CLOSE_INACTIVE_HOURS) return

    try {
        const users = await db.getAllUsers()
        const cutoffTime = Date.now() - (config.AUTO_CLOSE_INACTIVE_HOURS * 60 * 60 * 1000)

        for (const user of users) {
            if (user.message_thread_id && user.last_activity < cutoffTime) {
                const topicStatus = await db.getTopicStatus(user.message_thread_id)

                if (topicStatus.status === 'opened') {
                    try {
                        await closeForumTopic(config.ADMIN_GROUP_ID, user.message_thread_id)
                        await db.setTopicStatus(user.message_thread_id, 'auto_closed', {
                            reason: 'inactive',
                            closed_at: Date.now(),
                            inactive_hours: config.AUTO_CLOSE_INACTIVE_HOURS
                        })

                        await sendMessage({
                            chat_id: config.ADMIN_GROUP_ID,
                            message_thread_id: user.message_thread_id,
                            text: `🕐 Topic auto-closed due to inactivity (${config.AUTO_CLOSE_INACTIVE_HOURS} hours)\nLast activity: ${formatTime(user.last_activity)}`
                        })

                        console.log(`Auto-closed topic ${user.message_thread_id} for user ${user.user_id}`)
                    } catch (error) {
                        console.error(`Failed to auto-close topic ${user.message_thread_id}:`, error)
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error checking inactive topics:', error)
    }
}

/**
 * Robot mention/reply detection and forwarding
 * 机器人提及/回复检测和转发
 */
export async function handleBotMentionOrReply(message) {
    const chat_id = message.chat.id
    const user_id = message.from.id
    const user = message.from

    console.log(`handleBotMentionOrReply: Processing message from user ${user_id} in chat ${chat_id}`)

    // If it's admin group, handle commands and skip admin messages
    // 如果是管理群组，处理命令并跳过管理员消息
    if (config.ADMIN_GROUP_ID && chat_id.toString() === config.ADMIN_GROUP_ID) {
        const messageText = message.text || message.caption || ''
        if (messageText.trim().startsWith('/')) {
            // Already handled by main router
            // 已由主路由器处理
            return false
        }
    }

    // Get bot info
    // 获取机器人信息
    const botInfo = await getBotInfo()
    if (!botInfo) {
        return false
    }

    const botUsername = botInfo.username

    // Check match
    // 检查匹配
    let isMention = false
    if (message.entities) {
        for (const entity of message.entities) {
            if (entity.type === 'mention') {
                const mention = message.text.substring(entity.offset, entity.offset + entity.length)
                if (mention === `@${botUsername}`) {
                    isMention = true
                    break
                }
            }
        }
    }

    const isReply = message.reply_to_message &&
        message.reply_to_message.from &&
        message.reply_to_message.from.is_bot &&
        message.reply_to_message.from.username === botUsername

    if (isMention || isReply) {
        console.log(`✅ Forwarding ${isMention ? 'mention' : 'reply'} to admin`)

        // Import forwardMessageU2A dynamically to avoid circular dependencies
        const { forwardMessageU2A } = await import('../core/messages.js');
        await forwardMessageU2A(message);

        return true
    }

    return false
}

export async function translateText(text, targetLang = config.TRANSLATE_TARGET_LANG) {
    if (!config.ENABLE_AUTO_TRANSLATE || !text || text.length < 1) {
        return null;
    }

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            // data[0] contains the translated segments
            if (data && data[0] && Array.isArray(data[0])) {
                let translated = '';
                for (const segment of data[0]) {
                    if (segment[0]) translated += segment[0];
                }

                // If the translation is practically the same as original, don't return it
                if (translated.trim() === text.trim()) return null;
                return translated;
            }
        }
    } catch (e) {
        console.error('Translation failed:', e);
    }

    return null;
}
