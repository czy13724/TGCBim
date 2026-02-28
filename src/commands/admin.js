/**
 * Admin Commands
 * 管理员命令
 */
import { config, isGlobalAdminOrOwner } from '../config.js';
import { db, d1, tplGet, tplSet, tplDel, tplList } from '../services/db.js';
import { sendMessage, copyMessage, closeForumTopic, reopenForumTopic } from '../services/telegram.js';
import { escapeHtml, delay, formatTime } from '../utils/utils.js';
import { getSpamKeywords, setSpamKeywords, checkSpam } from '../core/spam.js';

// === Broadcast ===
// === 广播 ===
export async function handleBroadcastCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return 'Unauthorized'

    const args = message.text.split(' ').slice(1)
    const text = args.join(' ')

    if (!text && !message.reply_to_message) {
        return sendMessage({ chat_id: message.chat.id, text: 'Usage: /broadcast <text> or reply to a message.' })
    }

    sendMessage({ chat_id: message.chat.id, text: `📢 Broadcast started in background...` })

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

    if (!targetId) {
        return sendMessage({
            chat_id: message.chat.id,
            text: `Usage: /${isBlock ? 'block' : 'unblock'} (reply or in topic or <id>)`,
            reply_to_message_id: message.message_id
        })
    }

    if (targetId.toString() === config.ADMIN_UID) return sendMessage({ chat_id: message.chat.id, text: "Can't block admin/owner." })

    if (isBlock) {
        await db.blockUser(targetId, true)
        await sendMessage({ chat_id: message.chat.id, text: `🚫 User ${targetId} blocked.` })
    } else {
        await db.blockUser(targetId, false)
        await db.blockUserOld(targetId, false)
        await sendMessage({ chat_id: message.chat.id, text: `✅ User ${targetId} unblocked.` })
    }
}

export async function handleCheckBlockCommand(message) {
    const thread_id = message.message_thread_id
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

    if (!targetId) return sendMessage({ chat_id: message.chat.id, text: 'No target found.' })

    const isBlocked = await db.isUserBlocked(targetId)
    const isBlockedOld = await db.isUserBlockedOld(targetId)

    await sendMessage({
        chat_id: message.chat.id,
        text: `User ${targetId}:\nNew Block: ${isBlocked}\nOld Block: ${isBlockedOld}`
    })
}

// === Management ===
// === 管理 ===
export async function handleClearCommand(message) {
    // Clear today's logs for the topic user
    // 清除话题用户当天的日志

    const thread_id = message.message_thread_id
    if (!thread_id) return sendMessage({ chat_id: message.chat.id, text: "Command must be used in a topic." })

    const user = await db.findUserByThreadId(thread_id)
    if (!user) return sendMessage({ chat_id: message.chat.id, text: "User not found for this topic." })

    const { formatDateKeyUTC } = await import('../utils/utils.js')
    const startDay = formatDateKeyUTC()
    try {
        const delStmt = d1.prepare("DELETE FROM message_logs WHERE user_id = ? AND date_key = ?");
        await delStmt.bind(user.user_id.toString(), startDay).run();
        await sendMessage({ chat_id: message.chat.id, message_thread_id: thread_id, text: "✅ Today's conversation log cleared from database." })
    } catch (e) {
        await sendMessage({ chat_id: message.chat.id, text: `Error clearing logs: ${e.message}` })
    }
}

export async function handleCloseCommand(message) {
    if (!message.message_thread_id) {
        return sendMessage({ chat_id: message.chat.id, text: '⚠️ This command only works inside a topic thread (requires Group Mode).', reply_to_message_id: message.message_id })
    }
    try {
        await closeForumTopic(message.chat.id, message.message_thread_id)
        await db.setTopicStatus(message.message_thread_id, 'closed')
        await sendMessage({ chat_id: message.chat.id, message_thread_id: message.message_thread_id, text: "Topic closed." })
    } catch (e) {
        return await sendMessage({ chat_id: message.chat.id, text: `Error: ${e.message}` })
    }
}

export async function handleReopenCommand(message) {
    if (!message.message_thread_id) {
        return sendMessage({ chat_id: message.chat.id, text: '⚠️ This command only works inside a topic thread (requires Group Mode).', reply_to_message_id: message.message_id })
    }
    try {
        await reopenForumTopic(message.chat.id, message.message_thread_id)
        await db.setTopicStatus(message.message_thread_id, 'opened')
        await sendMessage({ chat_id: message.chat.id, message_thread_id: message.message_thread_id, text: "Topic reopened." })
    } catch (e) {
        return await sendMessage({ chat_id: message.chat.id, text: `Error: ${e.message}` })
    }
}

export async function handleMaintenanceToggle(enable, message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return

    if (enable) {
        const stmt = d1.prepare("INSERT INTO counters (key, value) VALUES ('maintenance_mode', 1) ON CONFLICT(key) DO UPDATE SET value = 1");
        await stmt.run();
        return await sendMessage({ chat_id: message.chat.id, text: "🛠 Maintenance mode ON", reply_to_message_id: message.message_id })
    } else {
        const stmt = d1.prepare("INSERT INTO counters (key, value) VALUES ('maintenance_mode', 0) ON CONFLICT(key) DO UPDATE SET value = 0");
        await stmt.run();
        return await sendMessage({ chat_id: message.chat.id, text: "✅ Maintenance mode OFF", reply_to_message_id: message.message_id })
    }
}

export async function handleTemplateCommand(message) {
    // Usage: /tpl add <key> <val> | del <key> | list | <key>
    // 用法：/tpl add <key> <val> | del <key> | list | <key>

    const args = message.text.split(' ')
    const sub = args[1]

    if (sub === 'add') {
        const key = args[2]
        const val = args.slice(3).join(' ')
        if (key && val) {
            await tplSet(key, val)
            return sendMessage({ chat_id: message.chat.id, text: `Template '${key}' saved.` })
        }
    } else if (sub === 'del') {
        const key = args[2]
        if (key) {
            await tplDel(key)
            return sendMessage({ chat_id: message.chat.id, text: `Template '${key}' deleted.` })
        }
    } else if (sub === 'list') {
        const list = await tplList()
        return sendMessage({ chat_id: message.chat.id, text: `Templates:\n${list.join('\n')}` })
    } else if (sub) {
        // Send template content
        // 发送模板内容
        const val = await tplGet(sub)
        if (val) {
            return sendMessage({ chat_id: message.chat.id, message_thread_id: message.message_thread_id, text: val })
        }
    }

    return sendMessage({ chat_id: message.chat.id, text: "Usage: /tpl add <k> <v> | del <k> | list | <k>" })
}

export async function handleUserInfoCommand(message) {
    const thread_id = message.message_thread_id
    let targetUser = null

    if (message.reply_to_message) {
        const uid = await db.getOldMessageMap(message.reply_to_message.message_id)
        if (uid) targetUser = await db.getUser(uid)
        // Fallback: use forward_from for old unmapped messages
        if (!targetUser && message.reply_to_message.forward_from) {
            const fwdId = message.reply_to_message.forward_from.id
            targetUser = await db.getUser(fwdId)
        }
    }

    if (!targetUser && thread_id) {
        targetUser = await db.findUserByThreadId(thread_id)
    }

    if (!targetUser) return sendMessage({ chat_id: message.chat.id, text: "User not found." })

    const isBlocked = await db.isUserBlocked(targetUser.user_id)

    let info = `👤 <b>User Info</b>\n`
    info += `ID: <code>${targetUser.user_id}</code>\n`
    info += `Name: ${escapeHtml(targetUser.first_name)} ${escapeHtml(targetUser.last_name || '')}\n`
    info += `Username: @${targetUser.username || ''}\n`
    info += `Created: ${formatTime(targetUser.created_at)}\n`
    info += `Status: ${isBlocked ? '🔴 Blocked' : '🟢 Active'}\n`

    await sendMessage({
        chat_id: message.chat.id,
        text: info,
        parse_mode: 'HTML'
    })
}

export async function handleUidCommand(message) {
    const thread_id = message.message_thread_id
    let targetId = null

    // 1. Reply
    // 1. 回复
    if (message.reply_to_message) {
        targetId = await db.getOldMessageMap(message.reply_to_message.message_id)
        // Fallback: use Telegram's forward_from for old/unmapped messages
        if (!targetId && message.reply_to_message.forward_from) {
            targetId = message.reply_to_message.forward_from.id
        }
    }

    // 2. Thread
    // 2. 话题
    if (!targetId && thread_id) {
        const u = await db.findUserByThreadId(thread_id)
        if (u) targetId = u.user_id
    }

    // 3. Args
    // 3. 参数
    const args = message.text.split(' ')
    if (!targetId && args.length > 1) {
        if (args[1].startsWith('@')) {
            const username = args[1].substring(1)
            targetId = await db.getUserIDByUsername(username)
            if (!targetId) {
                return sendMessage({ chat_id: message.chat.id, text: `Username @${username} not found in database index.` })
            }
        } else {
            targetId = args[1]
        }
    }

    if (targetId) {
        return await sendMessage({ chat_id: message.chat.id, text: `UID: <code>${targetId}</code>`, parse_mode: 'HTML', reply_to_message_id: message.message_id })
    } else {
        return await sendMessage({ chat_id: message.chat.id, text: "UID not found. Usage: /uid (reply | @username | <id>)", reply_to_message_id: message.message_id })
    }
}

export async function handleSpamCommand(message, command) {
    const args = message.text.split(/\s+/)

    if (command === '/addspam') {
        const kw = args.slice(1).join(' ')
        if (!kw) return sendMessage({ chat_id: message.chat.id, text: "Usage: /addspam <keyword>" })

        let current = await getSpamKeywords()
        const list = current ? current.split(',') : []
        if (list.includes(kw)) return sendMessage({ chat_id: message.chat.id, text: "Exists." })

        list.push(kw)
        await setSpamKeywords(list.join(','))
        return sendMessage({ chat_id: message.chat.id, text: `Added '${kw}'.` })
    }

    if (command === '/removespam') {
        const kw = args.slice(1).join(' ')
        if (!kw) return sendMessage({ chat_id: message.chat.id, text: "Usage: /removespam <keyword>" })

        let current = await getSpamKeywords()
        let list = current ? current.split(',') : []
        if (!list.includes(kw)) return sendMessage({ chat_id: message.chat.id, text: "Not found." })

        list = list.filter(k => k !== kw)
        await setSpamKeywords(list.join(','))
        return sendMessage({ chat_id: message.chat.id, text: `Removed '${kw}'.` })
    }

    if (command === '/listspam') {
        let current = await getSpamKeywords()
        return sendMessage({ chat_id: message.chat.id, text: `Spam Keywords:\n` + (current || '').split(',').join('\n') })
    }

    if (command === '/checkspam') {
        const txt = args.slice(1).join(' ')
        const res = await checkSpam({ text: txt })
        return sendMessage({ chat_id: message.chat.id, text: `Is Spam: ${res.isSpam}\nMatch: ${res.matchedKeyword || res.matchedPattern || '-'}` })
    }

    if (command === '/spamstats') {
        const blocked = await db.getCounter('spam_blocked')
        return sendMessage({ chat_id: message.chat.id, text: `Spam Blocked: ${blocked}` })
    }
}

export async function handleWhitelistCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return sendMessage({ chat_id: message.chat.id, text: 'Unauthorized' })

    const args = message.text.split(/\s+/)
    const sub = args[1]?.toLowerCase()

    if (sub === 'add') {
        const targetId = args[2]
        if (!targetId && message.reply_to_message) {
            let replyId = await db.getOldMessageMap(message.reply_to_message.message_id)
            // Fallback: use forward_from for old unmapped messages
            if (!replyId && message.reply_to_message.forward_from) {
                replyId = message.reply_to_message.forward_from.id?.toString()
            }
            if (replyId) {
                await db.addToWhitelist(replyId)
                return sendMessage({ chat_id: message.chat.id, text: `✅ Added ${replyId} to whitelist.` })
            }
            const threadId = message.message_thread_id;
            if (threadId) {
                const u = await db.findUserByThreadId(threadId)
                if (u) {
                    await db.addToWhitelist(u.user_id)
                    return sendMessage({ chat_id: message.chat.id, text: `✅ Added ${u.user_id} to whitelist.` })
                }
            }
            return sendMessage({ chat_id: message.chat.id, text: "Usage: /whitelist add <id> or reply to user message." })
        } else if (targetId) {
            await db.addToWhitelist(targetId)
            return sendMessage({ chat_id: message.chat.id, text: `✅ Added ${targetId} to whitelist.` })
        }
        return sendMessage({ chat_id: message.chat.id, text: "Usage: /whitelist add <id>" })
    }

    if (sub === 'remove' || sub === 'del') {
        const targetId = args[2]
        if (!targetId && message.reply_to_message) {
            let replyId = await db.getOldMessageMap(message.reply_to_message.message_id)
            // Fallback: use forward_from for old unmapped messages
            if (!replyId && message.reply_to_message.forward_from) {
                replyId = message.reply_to_message.forward_from.id?.toString()
            }
            if (replyId) {
                await db.removeFromWhitelist(replyId)
                return sendMessage({ chat_id: message.chat.id, text: `✅ Removed ${replyId} from whitelist.` })
            }
            const threadId = message.message_thread_id;
            if (threadId) {
                const u = await db.findUserByThreadId(threadId)
                if (u) {
                    await db.removeFromWhitelist(u.user_id)
                    return sendMessage({ chat_id: message.chat.id, text: `✅ Removed ${u.user_id} from whitelist.` })
                }
            }
            return sendMessage({ chat_id: message.chat.id, text: "Usage: /whitelist remove <id> or reply to user message." })
        } else if (targetId) {
            await db.removeFromWhitelist(targetId)
            return sendMessage({ chat_id: message.chat.id, text: `✅ Removed ${targetId} from whitelist.` })
        }
        return sendMessage({ chat_id: message.chat.id, text: "Usage: /whitelist remove <id>" })
    }

    if (sub === 'list') {
        const wl = await db.getWhitelistedUsers()
        return sendMessage({ chat_id: message.chat.id, text: `📋 Whitelist:\n` + (wl.length ? wl.join('\n') : 'Empty') })
    }

    return sendMessage({ chat_id: message.chat.id, text: "Usage: /whitelist add <id> | remove <id> | list" })
}
