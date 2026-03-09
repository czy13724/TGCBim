/**
 * Admin Commands
 * 管理员命令
 */
import { config, isGlobalAdminOrOwner, isOwner } from '../config.js';
import { db, d1, tplGet, tplSet, tplDel, tplList } from '../services/db.js';
import { sendMessage, copyMessage, closeForumTopic, reopenForumTopic, editMessage, answerCallbackQuery } from '../services/telegram.js';
import { escapeHtml, delay, formatTime } from '../utils/utils.js';
import { getSpamKeywords, setSpamKeywords, checkSpam } from '../core/spam.js';
import { getLang, t } from '../services/i18n.js';

const LISTSPAM_MAX_ITEMS_PER_PAGE = 80
const LISTSPAM_MAX_BODY_LENGTH = 3200

async function logAdminAction(message, action, targetId = null, success = true, detail = null) {
    await db.addAdminAuditLog({
        admin_id: message?.from?.id,
        action,
        target_id: targetId,
        chat_id: message?.chat?.id,
        thread_id: message?.message_thread_id,
        success,
        detail
    })
}

async function getAdminLang(user) {
    const dbUser = await db.getUser(user.id).catch(() => null)
    return getLang(dbUser || user)
}

async function denyIfSafeMode(message, lang, action) {
    if (config.SAFE_MODE && !isOwner(message.from.id)) {
        await logAdminAction(message, action, null, false, 'blocked_by_safe_mode')
        await sendMessage({ chat_id: message.chat.id, text: t('admin_safe_mode_blocked', lang), reply_to_message_id: message.message_id })
        return true
    }
    return false
}

// === Broadcast ===
// === 广播 ===
export async function handleBroadcastCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return 'Unauthorized'
    const lang = await getAdminLang(message.from)
    if (await denyIfSafeMode(message, lang, 'broadcast')) return

    const args = message.text.split(' ').slice(1)
    const text = args.join(' ')

    if (!text && !message.reply_to_message) {
        return sendMessage({ chat_id: message.chat.id, text: 'Usage: /broadcast <text> or reply to a message.' })
    }

    sendMessage({ chat_id: message.chat.id, text: `📢 Broadcast started in background...` })
    await logAdminAction(message, 'broadcast_start', null, true, `args_length=${args.length}`)

    // Execute broadcast logic
    // 执行广播逻辑
    const runBroadcast = async () => {
        const users = await db.getAllUsers(100000) // Large limit for pagination
        // 分页的大限制
        let count = 0
        let failed = 0
        const startTime = Date.now()

        const method = message.reply_to_message ? 'copyMessage' : 'sendMessage'

        for (const user of users) {
            try {
                if (method === 'copyMessage') {
                    await copyMessage({
                        chat_id: user.user_id,
                        from_chat_id: message.chat.id,
                        message_id: message.reply_to_message.message_id
                    })
                } else {
                    await sendMessage({
                        chat_id: user.user_id,
                        text: text
                    })
                }
                count++
            } catch (e) {
                failed++
                console.error(`Broadcast failed for ${user.user_id}:`, e)
            }
            if (count % 20 === 0) await delay(200) // Rate limit protection
            // 速率限制保护
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        await sendMessage({
            chat_id: message.chat.id,
            text: `✅ Broadcast complete.\nSent: ${count}\nFailed: ${failed}\nDuration: ${duration}s`,
            reply_to_message_id: message.message_id
        })
        await logAdminAction(message, 'broadcast_finish', null, true, `sent=${count},failed=${failed},duration=${duration}s`)
    }

    // Run in background using waitUntil if available
    // 如果可用，使用 waitUntil 在后台运行
    if (message.waitUntil) {
        message.waitUntil(runBroadcast())
    } else {
        runBroadcast().catch(e => console.error('Broadcast execution error:', e))
    }
}

// === Block / Unblock ===
// === 封禁 / 解封 ===
export async function handleBlockCommand(message) {
    return handleBlockUnblock(message, true)
}

export async function handleUnblockCommand(message) {
    return handleBlockUnblock(message, false)
}

async function handleBlockUnblock(message, isBlock) {
    const thread_id = message.message_thread_id
    let targetId = null

    // 1. Check reply
    // 1. 检查回复
    if (message.reply_to_message) {
        const oldMap = await db.getOldMessageMap(message.reply_to_message.message_id)
        if (oldMap) targetId = oldMap
        // Fallback: use Telegram's forward_from for old/unmapped messages
        if (!targetId && message.reply_to_message.forward_from) {
            targetId = message.reply_to_message.forward_from.id
        }
    }

    // 2. Check thread
    // 2. 检查话题
    if (!targetId && thread_id) {
        const user = await db.findUserByThreadId(thread_id)
        if (user) targetId = user.user_id
    }

    // 3. Check arguments
    // 3. 检查参数
    const args = message.text.split(' ')
    if (!targetId && args.length > 1) {
        targetId = args[1]
    }

    const lang = await getAdminLang(message.from)
    const actionName = isBlock ? 'block' : 'unblock'
    if (await denyIfSafeMode(message, lang, actionName)) return

    if (!targetId) {
        return sendMessage({
            chat_id: message.chat.id,
            text: t('admin_block_usage', lang, { CMD: isBlock ? 'block' : 'unblock' }),
            reply_to_message_id: message.message_id
        })
    }

    if (targetId.toString() === config.ADMIN_UID) return sendMessage({ chat_id: message.chat.id, text: t('admin_block_self', lang) })

    if (isBlock) {
        await db.blockUser(targetId, true)
        await logAdminAction(message, 'block', targetId, true, 'manual')
        await sendMessage({ chat_id: message.chat.id, text: t('admin_blocked', lang, { UID: targetId }) })
    } else {
        await db.blockUser(targetId, false)
        await db.blockUserOld(targetId, false)
        await logAdminAction(message, 'unblock', targetId, true, 'manual')
        await sendMessage({ chat_id: message.chat.id, text: t('admin_unblocked', lang, { UID: targetId }) })
    }
}

export async function handleCheckBlockCommand(message) {
    const thread_id = message.message_thread_id
    const lang = await getAdminLang(message.from)
    let targetId = null
    if (message.reply_to_message) {
        targetId = await db.getOldMessageMap(message.reply_to_message.message_id)
        if (!targetId && message.reply_to_message.forward_from) {
            targetId = message.reply_to_message.forward_from.id
        }
    }
    if (!targetId && thread_id) {
        const user = await db.findUserByThreadId(thread_id)
        if (user) targetId = user.user_id
    }
    const args = message.text.split(' ')
    if (!targetId && args.length > 1) targetId = args[1]

    if (!targetId) return sendMessage({ chat_id: message.chat.id, text: t('admin_no_target', lang) })

    const isBlocked = await db.isUserBlocked(targetId)
    const isBlockedOld = await db.isUserBlockedOld(targetId)

    await sendMessage({
        chat_id: message.chat.id,
        text: t('admin_check_block', lang, { UID: targetId, STATUS: isBlocked || isBlockedOld ? '🔴' : '🟢' })
    })
}

// === Management ===
// === 管理 ===
export async function handleClearCommand(message) {
    const lang = await getAdminLang(message.from)
    const thread_id = message.message_thread_id
    if (!thread_id) return sendMessage({ chat_id: message.chat.id, text: t('admin_topic_only', lang), reply_to_message_id: message.message_id })

    const user = await db.findUserByThreadId(thread_id)
    if (!user) return sendMessage({ chat_id: message.chat.id, text: t('admin_user_not_found_topic', lang) })

    const { formatDateKeyUTC } = await import('../utils/utils.js')
    const startDay = formatDateKeyUTC()
    try {
        const delStmt = d1.prepare("DELETE FROM message_logs WHERE user_id = ? AND date_key = ?");
        await delStmt.bind(user.user_id.toString(), startDay).run();
        await sendMessage({ chat_id: message.chat.id, message_thread_id: thread_id, text: t('admin_log_cleared', lang) })
    } catch (e) {
        await sendMessage({ chat_id: message.chat.id, text: t('admin_log_clear_error', lang, { MSG: e.message }) })
    }
}

export async function handleCloseCommand(message) {
    const lang = await getAdminLang(message.from)
    if (!message.message_thread_id) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_topic_only', lang), reply_to_message_id: message.message_id })
    }
    try {
        await closeForumTopic(message.chat.id, message.message_thread_id)
        await db.setTopicStatus(message.message_thread_id, 'closed')
        await sendMessage({ chat_id: message.chat.id, message_thread_id: message.message_thread_id, text: t('admin_topic_closed', lang) })
    } catch (e) {
        return await sendMessage({ chat_id: message.chat.id, text: t('admin_error', lang, { MSG: e.message }) })
    }
}

export async function handleReopenCommand(message) {
    const lang = await getAdminLang(message.from)
    if (!message.message_thread_id) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_topic_only', lang), reply_to_message_id: message.message_id })
    }
    try {
        await reopenForumTopic(message.chat.id, message.message_thread_id)
        await db.setTopicStatus(message.message_thread_id, 'opened')
        await sendMessage({ chat_id: message.chat.id, message_thread_id: message.message_thread_id, text: t('admin_topic_reopened', lang) })
    } catch (e) {
        return await sendMessage({ chat_id: message.chat.id, text: t('admin_error', lang, { MSG: e.message }) })
    }
}

export async function handleMaintenanceToggle(enable, message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return
    const lang = await getAdminLang(message.from)
    if (await denyIfSafeMode(message, lang, 'maintenance_toggle')) return

    if (enable) {
        const stmt = d1.prepare("INSERT INTO counters (key, value) VALUES ('maintenance_mode', 1) ON CONFLICT(key) DO UPDATE SET value = 1");
        await stmt.run();
        await logAdminAction(message, 'maintenance_on', null, true)
        return await sendMessage({ chat_id: message.chat.id, text: t('admin_maintenance_on', lang), reply_to_message_id: message.message_id })
    } else {
        const stmt = d1.prepare("INSERT INTO counters (key, value) VALUES ('maintenance_mode', 0) ON CONFLICT(key) DO UPDATE SET value = 0");
        await stmt.run();
        await logAdminAction(message, 'maintenance_off', null, true)
        return await sendMessage({ chat_id: message.chat.id, text: t('admin_maintenance_off', lang), reply_to_message_id: message.message_id })
    }
}

export async function handleTemplateCommand(message) {
    const lang = await getAdminLang(message.from)
    const args = message.text.split(' ')
    const sub = args[1]

    if (sub === 'add') {
        const key = args[2]
        const val = args.slice(3).join(' ')
        if (key && val) {
            await tplSet(key, val)
            return sendMessage({ chat_id: message.chat.id, text: t('admin_tpl_saved', lang, { KEY: key }) })
        }
    } else if (sub === 'del') {
        const key = args[2]
        if (key) {
            await tplDel(key)
            return sendMessage({ chat_id: message.chat.id, text: t('admin_tpl_deleted', lang, { KEY: key }) })
        }
    } else if (sub === 'list') {
        const list = await tplList()
        if (!list.length) return sendMessage({ chat_id: message.chat.id, text: t('admin_tpl_empty', lang) })
        return sendMessage({ chat_id: message.chat.id, text: `📋 ${list.join('\n')}` })
    } else if (sub) {
        const val = await tplGet(sub)
        if (val) {
            return sendMessage({ chat_id: message.chat.id, message_thread_id: message.message_thread_id, text: val })
        }
        return sendMessage({ chat_id: message.chat.id, text: t('admin_tpl_not_found', lang, { KEY: sub }) })
    }

    return sendMessage({ chat_id: message.chat.id, text: t('admin_tpl_usage', lang) })
}

export async function handleUserInfoCommand(message) {
    const lang = await getAdminLang(message.from)
    const thread_id = message.message_thread_id
    let targetUser = null

    if (message.reply_to_message) {
        const uid = await db.getOldMessageMap(message.reply_to_message.message_id)
        if (uid) targetUser = await db.getUser(uid)
        if (!targetUser && message.reply_to_message.forward_from) {
            targetUser = await db.getUser(message.reply_to_message.forward_from.id)
        }
    }

    if (!targetUser && thread_id) {
        targetUser = await db.findUserByThreadId(thread_id)
    }

    if (!targetUser) return sendMessage({ chat_id: message.chat.id, text: t('admin_user_not_found', lang) })

    const isBlocked = await db.isUserBlocked(targetUser.user_id)

    const labels = lang === 'zh'
        ? { title: '👤 <b>用户信息</b>', id: 'ID', name: '姓名', username: '用户名', created: '注册时间', status: '状态', blocked: '🔴 已封禁', active: '� 正常' }
        : { title: '�👤 <b>User Info</b>', id: 'ID', name: 'Name', username: 'Username', created: 'Created', status: 'Status', blocked: '🔴 Blocked', active: '🟢 Active' }

    let info = `${labels.title}\n`
    info += `${labels.id}: <code>${targetUser.user_id}</code>\n`
    info += `${labels.name}: ${escapeHtml(targetUser.first_name)} ${escapeHtml(targetUser.last_name || '')}\n`
    info += `${labels.username}: @${targetUser.username || ''}\n`
    info += `${labels.created}: ${formatTime(targetUser.created_at)}\n`
    info += `${labels.status}: ${isBlocked ? labels.blocked : labels.active}\n`

    await sendMessage({ chat_id: message.chat.id, text: info, parse_mode: 'HTML' })
}

export async function handleUidCommand(message) {
    const thread_id = message.message_thread_id
    const lang = await getAdminLang(message.from)
    let targetId = null

    if (message.reply_to_message) {
        targetId = await db.getOldMessageMap(message.reply_to_message.message_id)
        if (!targetId && message.reply_to_message.forward_from) {
            targetId = message.reply_to_message.forward_from.id
        }
    }

    if (!targetId && thread_id) {
        const u = await db.findUserByThreadId(thread_id)
        if (u) targetId = u.user_id
    }

    const args = message.text.split(' ')
    if (!targetId && args.length > 1) {
        if (args[1].startsWith('@')) {
            const username = args[1].substring(1)
            targetId = await db.getUserIDByUsername(username)
            if (!targetId) {
                return sendMessage({ chat_id: message.chat.id, text: t('admin_username_not_found', lang, { USERNAME: username }), reply_to_message_id: message.message_id })
            }
        } else {
            targetId = args[1]
        }
    }

    if (targetId) {
        return await sendMessage({ chat_id: message.chat.id, text: `UID: <code>${targetId}</code>`, parse_mode: 'HTML', reply_to_message_id: message.message_id })
    } else {
        return await sendMessage({ chat_id: message.chat.id, text: t('admin_uid_not_found', lang), reply_to_message_id: message.message_id })
    }
}

export async function handleSpamCommand(message, command) {
    const args = message.text.split(/\s+/)
    const lang = await getAdminLang(message.from)
    const mutating = ['/addspam', '/removespam', '/refreshspam'].includes(command)
    if (mutating && await denyIfSafeMode(message, lang, `spam_${command.slice(1)}`)) return

    if (command === '/addspam') {
        const kw = args.slice(1).join(' ')
        if (!kw) return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_usage_add', lang) })
        let current = await getSpamKeywords()
        const list = current ? current.split(',') : []
        if (list.includes(kw)) return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_exists', lang) })
        list.push(kw)
        await setSpamKeywords(list.join(','))
        await logAdminAction(message, 'spam_add', kw, true)
        return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_added', lang, { KW: kw }) })
    }

    if (command === '/removespam') {
        const kw = args.slice(1).join(' ')
        if (!kw) return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_usage_remove', lang) })
        let current = await getSpamKeywords()
        let list = current ? current.split(',') : []
        if (!list.includes(kw)) return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_not_found', lang) })
        list = list.filter(k => k !== kw)
        await setSpamKeywords(list.join(','))
        await logAdminAction(message, 'spam_remove', kw, true)
        return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_removed', lang, { KW: kw }) })
    }

    if (command === '/listspam') {
        const current = await getSpamKeywords()
        const list = (current || '').split(',').map(k => k.trim()).filter(Boolean)

        if (list.length === 0) {
            return sendMessage({ chat_id: message.chat.id, text: lang === 'zh' ? '垃圾关键词为空。' : 'Spam keyword list is empty.' })
        }

        const totalPages = Math.max(1, Math.ceil(list.length / LISTSPAM_MAX_ITEMS_PER_PAGE))
        let page = Number.parseInt(args[1] || '1', 10)
        if (!Number.isFinite(page) || page < 1) page = 1
        if (page > totalPages) page = totalPages

        const from = (page - 1) * LISTSPAM_MAX_ITEMS_PER_PAGE
        const hardTo = Math.min(list.length, from + LISTSPAM_MAX_ITEMS_PER_PAGE)

        const lines = []
        let bodyLength = 0
        for (let i = from; i < hardTo; i++) {
            let line = `${i + 1}. ${list[i]}`
            if (line.length > 500) line = `${line.slice(0, 500)}...`
            if (bodyLength + line.length + 1 > LISTSPAM_MAX_BODY_LENGTH && lines.length > 0) break
            lines.push(line)
            bodyLength += line.length + 1
        }

        const shownTo = from + lines.length
        const header = lang === 'zh'
            ? `垃圾关键词（第 ${page}/${totalPages} 页，显示 ${from + 1}-${shownTo} / 共 ${list.length} 条）\n用法：/listspam [页码]\n\n`
            : `Spam Keywords (Page ${page}/${totalPages}, showing ${from + 1}-${shownTo} of ${list.length})\nUsage: /listspam [page]\n\n`

        return sendMessage({ chat_id: message.chat.id, text: `${header}${lines.join('\n')}` })
    }

    if (command === '/checkspam') {
        const txt = args.slice(1).join(' ')
        const res = await checkSpam({ text: txt })
        const isSpamStr = lang === 'zh' ? (res.isSpam ? '是' : '否') : String(res.isSpam)
        return sendMessage({ chat_id: message.chat.id, text: (lang === 'zh' ? `垃圾判断：${isSpamStr}\n匹配：` : `Is Spam: ${isSpamStr}\nMatch: `) + (res.matchedKeyword || res.matchedPattern || '-') })
    }

    if (command === '/spamstats') {
        const detected = await db.getCounter('spam_detected')
        const warned = await db.getCounter('spam_warned')
        const blocked = await db.getCounter('spam_blocked')
        if (lang === 'zh') {
            return sendMessage({ chat_id: message.chat.id, text: `垃圾检测：${detected} 次\n警告：${warned} 次\n封禁：${blocked} 次` })
        }
        return sendMessage({ chat_id: message.chat.id, text: `Spam Detected: ${detected}\nWarnings: ${warned}\nBlocked: ${blocked}` })
    }

    if (command === '/refreshspam') {
        await sendMessage({ chat_id: message.chat.id, text: t('admin_spam_refreshing', lang) })
        try {
            const delStmt = d1.prepare("DELETE FROM system_cache WHERE key = 'spam_blocklist_cache'")
            await delStmt.run()
            const freshKeywords = await getSpamKeywords()
            const count = freshKeywords ? freshKeywords.split(',').filter(Boolean).length : 0
            await logAdminAction(message, 'spam_refresh', null, true, `count=${count}`)
            return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_refreshed', lang, { COUNT: count }) })
        } catch (e) {
            await logAdminAction(message, 'spam_refresh', null, false, e.message)
            return sendMessage({ chat_id: message.chat.id, text: t('admin_spam_refresh_fail', lang, { MSG: e.message }) })
        }
    }
}

export async function handleAuditCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return
    const lang = await getAdminLang(message.from)
    const args = message.text.split(/\s+/)
    const requested = Number.parseInt(args[1] || '20', 10)
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 20

    const rows = await db.getAdminAuditLogs(limit)
    if (!rows.length) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_audit_empty', lang), reply_to_message_id: message.message_id })
    }

    const title = lang === 'zh' ? `🧾 最近管理员操作（${rows.length}条）\n` : `🧾 Recent Admin Actions (${rows.length})\n`
    const lines = rows.map(row => {
        const time = new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 19)
        const ok = row.success ? 'OK' : 'FAIL'
        const target = row.target_id ? ` target=${row.target_id}` : ''
        const detail = row.detail ? ` detail=${row.detail}` : ''
        return `${time} #${row.id} admin=${row.admin_id} ${row.action}${target} ${ok}${detail}`
    })

    return sendMessage({
        chat_id: message.chat.id,
        text: `${title}${lines.join('\n')}`.slice(0, 3900),
        reply_to_message_id: message.message_id
    })
}

export async function handleWhitelistCommand(message) {
    const lang = await getAdminLang(message.from)
    if (!isGlobalAdminOrOwner(message.from.id)) return sendMessage({ chat_id: message.chat.id, text: t('admin_unauthorized', lang) })

    const args = message.text.split(/\s+/)
    const sub = args[1]?.toLowerCase()

    if (sub === 'add') {
        if (await denyIfSafeMode(message, lang, 'whitelist_add')) return
        const targetId = args[2]
        if (!targetId && message.reply_to_message) {
            let replyId = await db.getOldMessageMap(message.reply_to_message.message_id)
            if (!replyId && message.reply_to_message.forward_from) {
                replyId = message.reply_to_message.forward_from.id?.toString()
            }
            if (replyId) {
                await db.addToWhitelist(replyId)
                await logAdminAction(message, 'whitelist_add', replyId, true, 'by_reply')
                return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_added', lang, { UID: replyId }) })
            }
            const threadId = message.message_thread_id;
            if (threadId) {
                const u = await db.findUserByThreadId(threadId)
                if (u) {
                    await db.addToWhitelist(u.user_id)
                    await logAdminAction(message, 'whitelist_add', u.user_id, true, 'by_thread')
                    return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_added', lang, { UID: u.user_id }) })
                }
            }
            return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_usage_add', lang) })
        } else if (targetId) {
            await db.addToWhitelist(targetId)
            await logAdminAction(message, 'whitelist_add', targetId, true, 'by_arg')
            return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_added', lang, { UID: targetId }) })
        }
        return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_usage_add2', lang) })
    }

    if (sub === 'remove' || sub === 'del') {
        if (await denyIfSafeMode(message, lang, 'whitelist_remove')) return
        const targetId = args[2]
        if (!targetId && message.reply_to_message) {
            let replyId = await db.getOldMessageMap(message.reply_to_message.message_id)
            if (!replyId && message.reply_to_message.forward_from) {
                replyId = message.reply_to_message.forward_from.id?.toString()
            }
            if (replyId) {
                await db.removeFromWhitelist(replyId)
                await logAdminAction(message, 'whitelist_remove', replyId, true, 'by_reply')
                return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_removed', lang, { UID: replyId }) })
            }
            const threadId = message.message_thread_id;
            if (threadId) {
                const u = await db.findUserByThreadId(threadId)
                if (u) {
                    await db.removeFromWhitelist(u.user_id)
                    await logAdminAction(message, 'whitelist_remove', u.user_id, true, 'by_thread')
                    return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_removed', lang, { UID: u.user_id }) })
                }
            }
            return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_usage_remove', lang) })
        } else if (targetId) {
            await db.removeFromWhitelist(targetId)
            await logAdminAction(message, 'whitelist_remove', targetId, true, 'by_arg')
            return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_removed', lang, { UID: targetId }) })
        }
        return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_usage_remove2', lang) })
    }

    if (sub === 'list') {
        const wl = await db.getWhitelistedUsers()
        const empty = t('admin_whitelist_empty', lang)
        return sendMessage({ chat_id: message.chat.id, text: (lang === 'zh' ? '📋 白名单：\n' : '📋 Whitelist:\n') + (wl.length ? wl.join('\n') : empty) })
    }

    return sendMessage({ chat_id: message.chat.id, text: t('admin_whitelist_usage', lang) })
}

// === Language Preference ===
// === 语言偏好 ===

function langKeyboard(currentLang) {
    return {
        inline_keyboard: [[
            { text: currentLang === 'zh' ? '🇨🇳 中文 ✓' : '🇨🇳 中文', callback_data: 'admin_lang:zh' },
            { text: currentLang === 'en' ? '🇺🇸 English ✓' : '🇺🇸 English', callback_data: 'admin_lang:en' }
        ]]
    }
}

export async function handleLangCommand(message) {
    const currentLang = await getAdminLang(message.from)
    const text = currentLang === 'zh'
        ? '🌐 <b>界面语言设置</b>\n\n当前：🇨🇳 中文\n\n点击按钮切换语言：'
        : '🌐 <b>Interface Language</b>\n\nCurrent: 🇺🇸 English\n\nTap a button to switch:'
    return sendMessage({
        chat_id: message.chat.id,
        text,
        parse_mode: 'HTML',
        reply_markup: langKeyboard(currentLang),
        reply_to_message_id: message.message_id
    })
}

export async function handleLangCallback(callbackQuery) {
    if (!callbackQuery.data?.startsWith('admin_lang:')) return false
    if (!isGlobalAdminOrOwner(callbackQuery.from.id)) return false

    const choice = callbackQuery.data.split(':')[1]  // 'zh' or 'en'
    const userId = callbackQuery.from.id
    const existing = await db.getUser(userId).catch(() => null)
    const currentLang = getLang(existing || callbackQuery.from)

    // Already selected language: return friendly hint and skip message edit.
    // 已是当前语言：给出友好提示并跳过编辑，避免 "message is not modified" 报错。
    if (choice === currentLang) {
        const sameLangText = choice === 'zh' ? '当前已经是中文。' : 'Already using English.'
        await answerCallbackQuery(callbackQuery.id, { text: sameLangText, show_alert: false })
        return true
    }

    // Persist pref_lang
    // 持久化语言偏好
    let dbUser = existing
    if (dbUser) {
        dbUser.pref_lang = choice
        await db.setUser(userId, dbUser)
    } else {
        await db.setUser(userId, {
            user_id: userId,
            first_name: callbackQuery.from.first_name || 'Admin',
            pref_lang: choice,
            created_at: Date.now(), updated_at: Date.now(), last_activity: Date.now()
        })
    }

    // Update the message to reflect new selection
    // 更新消息以反映新选择
    const newText = choice === 'zh'
        ? '🌐 <b>界面语言设置</b>\n\n当前：🇨🇳 中文\n\n点击按钮切换语言：'
        : '🌐 <b>Interface Language</b>\n\nCurrent: 🇺🇸 English\n\nTap a button to switch:'
    const alertText = choice === 'zh' ? '✅ 已切换为中文' : '✅ Switched to English'

    await editMessage({
        chat_id: callbackQuery.message.chat.id,
        message_id: callbackQuery.message.message_id,
        text: newText,
        parse_mode: 'HTML',
        reply_markup: langKeyboard(choice)
    })
    await answerCallbackQuery(callbackQuery.id, { text: alertText })
    return true
}
