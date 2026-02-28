/**
 * Spam detection support
 * 垃圾邮件检测支持
 */
import { config, isGlobalAdminOrOwner } from '../config.js';
import { db, d1 } from '../services/db.js';
import { sendMessage, deleteMessage, banChatMember, kickChatMember } from '../services/telegram.js';
import { getLang, t } from '../services/i18n.js';
import { escapeHtml } from '../utils/utils.js';

/**
 * Get spam keywords (with caching)
 * 获取垃圾邮件关键词（带缓存）
 */
export async function getSpamKeywords() {
    try {
        const stmt = d1.prepare("SELECT value FROM system_cache WHERE key = 'spam_keywords'");
        const stored = await stmt.first();
        if (stored) return stored.value;
    } catch (e) {
        console.error('Error getting spam keywords from D1:', e)
    }

    // Check cached blocklist first (1 month TTL)
    // 首先检查缓存的阻止列表（1 个月 TTL）
    let allKeywords = config.SPAM_KEYWORDS

    try {
        const stmt = d1.prepare("SELECT value FROM system_cache WHERE key = 'spam_blocklist_cache'");
        const cacheRow = await stmt.first();
        if (cacheRow) {
            const cached = JSON.parse(cacheRow.value);
            if (cached && cached.timestamp && (Date.now() - cached.timestamp < 2592000000)) {
                // Cache is fresh (< 1 month)
                // 缓存是新鲜的（< 1 个月）
                console.log('Using cached blocklist')
                return cached.keywords
            }
        }
    } catch (e) {
        console.error('Error reading blocklist cache:', e)
    }

    // Cache expired or doesn't exist, fetch from GitHub
    // 缓存过期或不存在，从 GitHub 获取
    if (config.SPAM_BLOCKLIST_URL) {
        try {
            console.log('Fetching fresh blocklist from GitHub')
            const response = await fetch(config.SPAM_BLOCKLIST_URL)
            if (response.ok) {
                const blocklistText = await response.text()
                const blocklistKeywords = blocklistText
                    .split('\n')
                    .map(k => k.trim())
                    .filter(k => k && !k.startsWith('#')) // Filter empty lines and comments
                    // 过滤空行和注释
                    .join(',')

                if (blocklistKeywords) {
                    // Merge with existing keywords
                    // 与现有关键词合并
                    const existingKeywords = allKeywords ? allKeywords.split(',').map(k => k.trim()).filter(Boolean) : []
                    const newKeywords = blocklistKeywords.split(',').map(k => k.trim()).filter(Boolean)
                    const mergedSet = new Set([...existingKeywords, ...newKeywords])
                    allKeywords = Array.from(mergedSet).join(',')

                    // Cache the merged result
                    // 缓存合并后的结果
                    try {
                        const setStmt = d1.prepare(`
                            INSERT INTO system_cache (key, value)
                            VALUES ('spam_blocklist_cache', ?)
                            ON CONFLICT(key) DO UPDATE SET value = excluded.value
                        `);
                        await setStmt.bind(JSON.stringify({
                            keywords: allKeywords,
                            timestamp: Date.now()
                        })).run();
                        console.log('Blocklist cached successfully')
                    } catch (e) {
                        console.error('Error caching blocklist:', e)
                    }
                }
            } else {
                console.warn(`GitHub blocklist fetch failed: ${response.status}`)
            }
        } catch (e) {
            console.error('Error fetching GitHub blocklist:', e)
            // Try to use expired cache as fallback
            // 尝试使用过期缓存作为后备
            try {
                const stmt = d1.prepare("SELECT value FROM system_cache WHERE key = 'spam_blocklist_cache'");
                const expiredRow = await stmt.first();
                if (expiredRow) {
                    const expiredCache = JSON.parse(expiredRow.value);
                    if (expiredCache && expiredCache.keywords) {
                        console.log('Using expired cache as fallback')
                        return expiredCache.keywords
                    }
                }
            } catch (fallbackError) {
                console.error('Fallback cache also failed:', fallbackError)
            }
        }
    }

    return allKeywords
}

// Set spam keywords to KV storage
// 将垃圾邮件关键词设置到 KV 存储
export async function setSpamKeywords(keywords) {
    try {
        const setStmt = d1.prepare(`
            INSERT INTO system_cache (key, value)
            VALUES ('spam_keywords', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        await setStmt.bind(keywords).run();

        // Clear cache to ensure immediate effect
        // 清除缓存以确保立即生效
        try {
            const delStmt = d1.prepare("DELETE FROM system_cache WHERE key = 'spam_blocklist_cache'");
            await delStmt.run();
        } catch (e) {
            console.error('Failed to clear blocklist cache:', e)
        }
        return true;
    } catch (e) {
        console.error('Error setting spam keywords:', e)
        return false;
    }
}

// Parse spam keywords and patterns
// 解析垃圾邮件关键词和模式
export function parseSpamKeywords(keywordsStr) {
    if (!keywordsStr) return { keywords: [], patterns: [] }

    const items = keywordsStr.split(',').map(k => k.trim()).filter(Boolean)
    const keywords = []
    const patterns = []

    for (const item of items) {
        // Check if it's a regex pattern (starts and ends with /)
        // 检查是否为正则表达式模式（以 / 开头和结尾）
        if (item.startsWith('/') && item.includes('/')) {
            try {
                const lastSlash = item.lastIndexOf('/')
                const pattern = item.slice(1, lastSlash)
                const flags = item.slice(lastSlash + 1)
                patterns.push(new RegExp(pattern, flags || 'i'))
            } catch (e) {
                console.error(`Invalid regex pattern: ${item}`, e)
                // Treat as keyword if regex is invalid
                // 如果正则表达式无效，则视为关键词
                keywords.push(item.toLowerCase())
            }
        } else {
            keywords.push(item.toLowerCase())
        }
    }

    return { keywords, patterns }
}

/**
 * Check if message contains spam
 * 检查消息是否包含垃圾内容
 */
export async function checkSpam(message) {
    if (!config.ENABLE_SPAM_FILTER) return { isSpam: false }

    const text = message.text || message.caption || ''
    if (!text) return { isSpam: false }

    const keywordsStr = await getSpamKeywords()
    const { keywords, patterns } = parseSpamKeywords(keywordsStr)

    const textLower = text.toLowerCase()

    // Check keywords
    // 检查关键词
    for (const keyword of keywords) {
        if (textLower.includes(keyword)) {
            return {
                isSpam: true,
                matchedKeyword: keyword,
                matchType: 'keyword'
            }
        }
    }

    // Check regex patterns
    // 检查正则表达式模式
    for (const pattern of patterns) {
        if (pattern.test(text)) {
            return {
                isSpam: true,
                matchedPattern: pattern.toString(),
                matchType: 'pattern'
            }
        }
    }

    // Additional pattern: detect patterns like "9000一部", "8888一台" etc
    // 额外模式：检测诸如“9000一部”、“8888一台”等模式
    const numberPattern = /[0-9]{4,}[一]\s*[部台个]/
    if (numberPattern.test(text)) {
        return {
            isSpam: true,
            matchedPattern: numberPattern.toString(),
            matchType: 'auto_pattern'
        }
    }

    return { isSpam: false }
}

// Handle spam detection
// 处理垃圾邮件检测
export async function handleSpamDetected(message, user, spamInfo) {
    const user_id = user.id
    const chat_id = message.chat.id

    console.log(`Spam detected from user ${user_id}:`, spamInfo)

    // Send notification to admin
    // 向管理员发送通知
    let alertText = `🚨 <b>Spam Detected</b>\n\n`
    alertText += `👤 <b>User:</b>\n`
    alertText += `• Name: ${escapeHtml(user.first_name || 'Unknown')}`
    if (user.last_name) alertText += ` ${escapeHtml(user.last_name)}`
    alertText += `\n• Username: ${user.username ? `@${user.username}` : 'None'}\n`
    alertText += `• User ID: <code>${user_id}</code>\n\n`

    alertText += `📝 <b>Message:</b>\n`
    alertText += `${escapeHtml(message.text || message.caption || '(media)')}\n\n`

    alertText += `🔍 <b>Detection:</b>\n`
    if (spamInfo.matchType === 'keyword') {
        alertText += `• Type: Keyword Match\n`
        alertText += `• Matched: "${escapeHtml(spamInfo.matchedKeyword)}"\n\n`
    } else if (spamInfo.matchType === 'pattern' || spamInfo.matchType === 'auto_pattern') {
        alertText += `• Type: Pattern Match\n`
        alertText += `• Pattern: <code>${escapeHtml(spamInfo.matchedPattern || 'auto')}</code>\n\n`
    }

    alertText += `⚙️ <b>Action Taken:</b>\n`

    // Take action based on SPAM_ACTION
    // 根据 SPAM_ACTION 采取行动
    if (config.SPAM_ACTION === 'block') {
        await db.blockUser(user_id, true)
        await db.incrementCounter('spam_blocked')
        alertText += `• ✅ User blocked automatically\n`

        // Delete message from user's chat if enabled
        // 如果启用，则从用户的聊天中删除消息
        if (config.DELETE_SPAM_MESSAGE) {
            try {
                await deleteMessage(chat_id, message.message_id)
                alertText += `• ✅ Spam message deleted from user chat\n`
            } catch (e) {
                console.error(`Failed to delete spam message ${message.message_id}:`, e)
                alertText += `• ⚠️ Could not delete message from user chat\n`
            }
        }

        alertText += `\n⏰ Time: ${new Date().toISOString()}`

        await sendMessage({
            chat_id: config.ADMIN_UID,
            text: alertText,
            parse_mode: 'HTML'
        })

        // Optionally send a message to the user
        // 可选：向用户发送消息
        try {
            let dbUser = null;
            try { dbUser = await db.getUser(user_id); } catch (e) { }
            const lang = getLang(dbUser || message.from);
            await sendMessage({
                chat_id: user_id,
                text: t('spam_blocked', lang)
            })
        } catch (e) {
            console.error('Failed to notify spam user:', e)
        }
    } else {
        // Just notify, don't block
        // 仅通知，不封禁
        alertText += `• ℹ️ User not blocked (notify mode)\n`
        alertText += `• ℹ️ Message not deleted\n`
        alertText += `\n⏰ Time: ${new Date().toISOString()}`

        const sent = await sendMessage({
            chat_id: config.ADMIN_UID,
            text: alertText,
            parse_mode: 'HTML'
        })

        if (sent && sent.ok) {
            // Mapping for reply capability (Group/Topic mode)
            // 回复功能的映射（群组/话题模式）
            await db.setMessageMap(`u2a:${message.message_id}`, sent.result.message_id)
            await db.setMessageMap(`a2u:${sent.result.message_id}`, message.message_id)

            // Mapping for reply capability (Legacy/Private mode)
            // 回复功能的映射（旧版/私有模式）
            await db.setOldMessageMap(sent.result.message_id, String(user_id))
        }
    }
}

/**
 * Group spam detection handler
 * 群组垃圾邮件检测处理程序
 */
export async function handleGroupSpam(message) {
    const chat_id = message.chat.id
    const user_id = message.from.id
    const user = message.from

    // Only handle admin group
    // 仅处理管理群组
    if (!config.ADMIN_GROUP_ID || chat_id.toString() !== config.ADMIN_GROUP_ID) {
        return false
    }

    // Skip if spam detection is disabled
    // 如果禁用了垃圾邮件检测，则跳过
    if (!config.GROUP_SPAM_DETECTION) {
        return false
    }

    // Skip admin and owner messages
    // 跳过管理员和所有者消息
    if (isGlobalAdminOrOwner(user_id)) {
        return false
    }

    // Check for spam
    // 检查垃圾邮件
    const spamCheck = await checkSpam(message)
    if (spamCheck.isSpam) {
        console.log(`Group spam detected from user ${user_id}`)

        // Delete the spam message
        // 删除垃圾消息
        try {
            await deleteMessage(chat_id, message.message_id)
        } catch (e) {
            console.error('Failed to delete group spam message:', e)
        }

        // Ban or kick user
        // 封禁或踢出用户
        try {
            if (config.GROUP_SPAM_ACTION === 'kick') {
                await kickChatMember(chat_id, user_id)
            } else {
                await banChatMember(chat_id, user_id)
            }
        } catch (e) {
            console.error('Failed to ban/kick user from group:', e)
        }

        // Notify admin
        // 通知管理员
        const groupInfo = message.chat.title || 'Admin Group'
        let alertText = `🚨 <b>Group Spam Detected</b>\n\n`
        alertText += `📍 <b>Group:</b> ${escapeHtml(groupInfo)}\n`
        alertText += `👤 <b>User:</b>\n`
        alertText += `• Name: ${escapeHtml(user.first_name || 'Unknown')}`
        if (user.last_name) alertText += ` ${escapeHtml(user.last_name)}`
        alertText += `\n• Username: ${user.username ? `@${user.username}` : 'None'}\n`
        alertText += `• User ID: <code>${user_id}</code>\n\n`

        alertText += `📝 <b>Message:</b>\n`
        alertText += `${escapeHtml(message.text || message.caption || '(media)')}\n\n`

        alertText += `🔍 <b>Detection:</b>\n`
        if (spamCheck.matchType === 'keyword') {
            alertText += `• Type: Keyword Match\n`
            alertText += `• Matched: "${escapeHtml(spamCheck.matchedKeyword)}"\n\n`
        } else if (spamCheck.matchType === 'pattern' || spamCheck.matchType === 'auto_pattern') {
            alertText += `• Type: Pattern Match\n`
            alertText += `• Pattern: <code>${escapeHtml(spamCheck.matchedPattern || 'auto')}</code>\n\n`
        }

        alertText += `⚙️ <b>Action Taken:</b>\n`
        alertText += `• 🗑️ Message deleted from group\n`
        alertText += `• ${config.GROUP_SPAM_ACTION === 'kick' ? '👢 User kicked from group' : '🚫 User banned from group'}\n`
        alertText += `\n⏰ Time: ${new Date().toISOString()}`

        await sendMessage({
            chat_id: config.ADMIN_UID,
            text: alertText,
            parse_mode: 'HTML'
        })

        return true // Spam detected and handled
    }

    return false // Not spam
}
