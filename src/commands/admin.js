/**
 * Admin Commands
 * 管理员命令
 */
import { config, getRuntimeAdmins, isGlobalAdminOrOwner, isOwner, setRuntimeAdmins } from '../config.js';
import { db, d1, tplGet, tplSet, tplDel, tplList } from '../services/db.js';
import { sendMessage, copyMessage, editMessage, answerCallbackQuery } from '../services/telegram.js';
import { escapeHtml, delay, formatTime, normalizeId, parseAdmins } from '../utils/utils.js';
import { getSpamKeywords, setSpamKeywords, checkSpam } from '../core/spam.js';
import { getLang, t } from '../services/i18n.js';

const LISTSPAM_MAX_ITEMS_PER_PAGE = 80
const LISTSPAM_MAX_BODY_LENGTH = 3200
const LISTSPAM_BUTTON_PAGE_SIZE = 50
const SYSTEM_CONFIG_KEY = 'system_config'
const DYNAMIC_ADMINS_KEY = 'dynamic_admins'
const PENDING_BROADCAST_KEY = 'pending_broadcast'

function userActionKeyboard(uid, lang, isBlocked, isWhitelisted) {
    const banText = isBlocked ? (lang === 'zh' ? '✅ 解封' : '✅ Unblock') : (lang === 'zh' ? '🚫 封禁' : '🚫 Block')
    const whitelistText = isWhitelisted ? (lang === 'zh' ? '🗑 白名单移除' : '🗑 Unwhitelist') : (lang === 'zh' ? '⭐ 白名单添加' : '⭐ Whitelist')
    const clearText = lang === 'zh' ? '🧹 清空历史' : '🧹 Clear History'
    return {
        inline_keyboard: [
            [
                { text: banText, callback_data: `admin:useract:${isBlocked ? 'unban' : 'ban'}:${uid}` },
                { text: whitelistText, callback_data: `admin:useract:${isWhitelisted ? 'unwhite' : 'white'}:${uid}` }
            ],
            [
                { text: clearText, callback_data: `admin:useract:clear:${uid}` }
            ]
        ]
    }
}

async function getDynamicAdmins() {
    const saved = await db.getUserState(SYSTEM_CONFIG_KEY, DYNAMIC_ADMINS_KEY).catch(() => null)
    if (!Array.isArray(saved)) return []
    return saved.map(v => normalizeId(v)).filter(Boolean)
}

async function saveDynamicAdmins(admins) {
    const normalized = Array.from(new Set((admins || []).map(v => normalizeId(v)).filter(Boolean)))
    await db.setUserState(SYSTEM_CONFIG_KEY, DYNAMIC_ADMINS_KEY, normalized)
    setRuntimeAdmins(normalized)
    return normalized
}

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

    const users = await db.getAllUsers(100000)
    const payload = {
        mode: message.reply_to_message ? 'reply' : 'text',
        text: text || '',
        source_chat_id: message.chat.id,
        source_message_id: message.reply_to_message?.message_id || null,
        created_at: Date.now(),
        recipient_count: users.length
    }
    await db.setUserState(message.from.id, PENDING_BROADCAST_KEY, payload)

    const modeLabel = payload.mode === 'reply' ? t('admin_broadcast_mode_reply', lang) : t('admin_broadcast_mode_text', lang)
    await sendMessage({
        chat_id: message.chat.id,
        text: `📢 <b>${t('admin_broadcast_preview_title', lang)}</b>\n\n${t('admin_broadcast_preview_info', lang, { COUNT: String(users.length), MODE: modeLabel })}`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: t('admin_broadcast_confirm_btn', lang), callback_data: `admin:broadcast:confirm:${message.from.id}` },
                { text: t('admin_broadcast_cancel_btn', lang), callback_data: `admin:broadcast:cancel:${message.from.id}` }
            ]]
        },
        reply_to_message_id: message.message_id
    })
    await logAdminAction(message, 'broadcast_preview', null, true, `args_length=${args.length}`)
}

async function executeBroadcast(payload, originMessage, lang) {
    await logAdminAction(originMessage, 'broadcast_start', null, true, `mode=${payload.mode},recipients=${payload.recipient_count}`)
    const users = await db.getAllUsers(100000)
    let count = 0
    let failed = 0
    const startTime = Date.now()

    for (const user of users) {
        try {
            if (payload.mode === 'reply' && payload.source_message_id) {
                await copyMessage({
                    chat_id: user.user_id,
                    from_chat_id: payload.source_chat_id,
                    message_id: payload.source_message_id
                })
            } else {
                await sendMessage({ chat_id: user.user_id, text: payload.text })
            }
            count++
        } catch (e) {
            failed++
            console.error(`Broadcast failed for ${user.user_id}:`, e)
        }
        if ((count + failed) % 20 === 0) await delay(200)
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    await sendMessage({
        chat_id: originMessage.chat.id,
        text: `✅ Broadcast complete.\nSent: ${count}\nFailed: ${failed}\nDuration: ${duration}s`,
        reply_to_message_id: originMessage.message_id
    })
    await logAdminAction(originMessage, 'broadcast_finish', null, true, `sent=${count},failed=${failed},duration=${duration}s`)
}

export async function handleBroadcastCallback(callbackQuery) {
    const data = callbackQuery?.data || ''
    if (!data.startsWith('admin:broadcast:')) return false

    const lang = await getAdminLang(callbackQuery.from)
    const [, , action, ownerId] = data.split(':')
    if (ownerId && normalizeId(ownerId) !== normalizeId(callbackQuery.from.id)) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_unauthorized', lang), show_alert: true })
        return true
    }

    const pending = await db.getUserState(callbackQuery.from.id, PENDING_BROADCAST_KEY).catch(() => null)
    if (!pending) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_broadcast_nothing', lang), show_alert: true })
        return true
    }

    if (action === 'cancel') {
        await db.deleteUserState(callbackQuery.from.id, PENDING_BROADCAST_KEY)
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_broadcast_cancelled', lang), show_alert: false })
        await editMessage({
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            text: t('admin_broadcast_cancelled', lang)
        }).catch(() => { })
        await db.addAdminAuditLog({
            admin_id: callbackQuery.from.id,
            action: 'broadcast_cancel',
            chat_id: callbackQuery.message?.chat?.id,
            thread_id: callbackQuery.message?.message_thread_id,
            success: true,
            detail: 'inline_button'
        })
        return true
    }

    await db.deleteUserState(callbackQuery.from.id, PENDING_BROADCAST_KEY)
    await answerCallbackQuery(callbackQuery.id, { text: t('admin_broadcast_confirmed', lang), show_alert: false })

    const originMessage = {
        from: callbackQuery.from,
        chat: callbackQuery.message.chat,
        message_id: callbackQuery.message.message_id,
        message_thread_id: callbackQuery.message.message_thread_id
    }
    const run = executeBroadcast(pending, originMessage, lang).catch(e => console.error('Broadcast execution error:', e))
    if (callbackQuery.waitUntil) {
        callbackQuery.waitUntil(run)
    } else {
        run
    }
    return true
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
    let targetId = null
    const thread_id = message.message_thread_id

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

    const args = message.text.split(/\s+/)
    if (!targetId && args.length > 1) {
        if (args[1].startsWith('@')) {
            const username = args[1].slice(1)
            targetId = await db.getUserIDByUsername(username)
        } else {
            targetId = args[1]
        }
    }

    if (!targetId) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_clear_usage', lang), reply_to_message_id: message.message_id })
    }

    try {
        const result = await db.clearUserHistory(targetId)
        await logAdminAction(message, 'clear_history', targetId, true, `logs=${result.deletedLogs},states=${result.deletedStates},maps=${result.deletedMaps}`)
        return sendMessage({
            chat_id: message.chat.id,
            text: t('admin_clear_done', lang, {
                UID: targetId,
                LOGS: String(result.deletedLogs),
                STATES: String(result.deletedStates),
                MAPS: String(result.deletedMaps)
            }),
            reply_to_message_id: message.message_id
        })
    } catch (e) {
        await logAdminAction(message, 'clear_history', targetId, false, e.message)
        return sendMessage({ chat_id: message.chat.id, text: t('admin_log_clear_error', lang, { MSG: e.message }) })
    }
}

export async function handleAddAdminCommand(message) {
    const lang = await getAdminLang(message.from)
    if (!isOwner(message.from.id)) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_addadmin_owner_only', lang), reply_to_message_id: message.message_id })
    }
    if (await denyIfSafeMode(message, lang, 'addadmin')) return

    const args = message.text.trim().split(/\s+/)
    const targetUid = normalizeId(args[1])
    if (!targetUid) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_addadmin_usage', lang), reply_to_message_id: message.message_id })
    }
    if (normalizeId(config.ADMIN_UID) === targetUid) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_addadmin_exists', lang, { UID: targetUid }), reply_to_message_id: message.message_id })
    }

    const fixedAdmins = parseAdmins(config.ADMINS)
    if (fixedAdmins.has(targetUid)) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_addadmin_exists', lang, { UID: targetUid }), reply_to_message_id: message.message_id })
    }

    const dynamicAdmins = await getDynamicAdmins()
    if (dynamicAdmins.includes(targetUid)) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_addadmin_exists', lang, { UID: targetUid }), reply_to_message_id: message.message_id })
    }

    const nextAdmins = [...dynamicAdmins, targetUid]
    await saveDynamicAdmins(nextAdmins)
    await logAdminAction(message, 'admin_add', targetUid, true, 'owner_command')
    return sendMessage({ chat_id: message.chat.id, text: t('admin_addadmin_done', lang, { UID: targetUid }), reply_to_message_id: message.message_id })
}

export async function handleRemoveAdminCommand(message) {
    const lang = await getAdminLang(message.from)
    if (!isOwner(message.from.id)) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_addadmin_owner_only', lang), reply_to_message_id: message.message_id })
    }
    if (await denyIfSafeMode(message, lang, 'removeadmin')) return

    const args = message.text.trim().split(/\s+/)
    const targetUid = normalizeId(args[1])
    if (!targetUid) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_removeadmin_usage', lang), reply_to_message_id: message.message_id })
    }

    const dynamicAdmins = await getDynamicAdmins()
    if (!dynamicAdmins.includes(targetUid)) {
        return sendMessage({ chat_id: message.chat.id, text: t('admin_removeadmin_not_found', lang, { UID: targetUid }), reply_to_message_id: message.message_id })
    }

    const nextAdmins = dynamicAdmins.filter(v => v !== targetUid)
    await saveDynamicAdmins(nextAdmins)
    await logAdminAction(message, 'admin_remove', targetUid, true, 'owner_command')
    return sendMessage({ chat_id: message.chat.id, text: t('admin_removeadmin_done', lang, { UID: targetUid }), reply_to_message_id: message.message_id })
}

export async function handleListAdminsCommand(message) {
    const lang = await getAdminLang(message.from)
    const zh = lang === 'zh'
    const fixedAdmins = Array.from(parseAdmins(config.ADMINS))
    const dynamicAdmins = getRuntimeAdmins()

    let text = zh ? '👥 <b>Bot 管理员</b>\n\n' : '👥 <b>Bot Administrators</b>\n\n'
    text += (zh ? '👑 <b>所有者：</b>' : '👑 <b>Owner:</b>') + ` <code>${escapeHtml(normalizeId(config.ADMIN_UID))}</code>\n\n`

    text += (zh ? '🔧 <b>固定管理员：</b>\n' : '🔧 <b>Fixed Admins:</b>\n')
    if (fixedAdmins.length) {
        fixedAdmins.forEach(id => { text += `  • <code>${escapeHtml(id)}</code>\n` })
    } else {
        text += zh ? '  • <i>无</i>\n' : '  • <i>None</i>\n'
    }

    text += `\n${zh ? '⚙️ <b>动态管理员：</b>\n' : '⚙️ <b>Dynamic Admins:</b>\n'}`
    if (dynamicAdmins.length) {
        dynamicAdmins.forEach(id => { text += `  • <code>${escapeHtml(id)}</code>\n` })
    } else {
        text += zh ? '  • <i>无</i>\n' : '  • <i>None</i>\n'
    }

    if (isOwner(message.from.id)) {
        text += zh ? '\n用法：/addadmin <uid>，/removeadmin <uid>' : '\nUsage: /addadmin <uid>, /removeadmin <uid>'
    }

    return sendMessage({ chat_id: message.chat.id, text, parse_mode: 'HTML', reply_to_message_id: message.message_id })
}

export async function handleMaintenanceToggle(enable, message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return
    const lang = await getAdminLang(message.from)
    if (await denyIfSafeMode(message, lang, 'maintenance_toggle')) return
    return setMaintenanceMode(enable, message, lang)
}

async function setMaintenanceMode(enable, message, lang) {
    const stmt = d1.prepare("INSERT INTO counters (key, value) VALUES ('maintenance_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    await stmt.bind(enable ? 1 : 0).run();
    await logAdminAction(message, enable ? 'maintenance_on' : 'maintenance_off', null, true)
    return await sendMessage({
        chat_id: message.chat.id,
        text: enable ? t('admin_maintenance_on', lang) : t('admin_maintenance_off', lang),
        reply_to_message_id: message.message_id
    })
}

function maintenanceKeyboard(lang) {
    return {
        inline_keyboard: [[
            { text: t('admin_maintenance_btn_on', lang), callback_data: 'admin:maint_on' },
            { text: t('admin_maintenance_btn_off', lang), callback_data: 'admin:maint_off' }
        ]]
    }
}

export async function handleMaintenanceCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) {
        const lang = await getAdminLang(message.from)
        return sendMessage({ chat_id: message.chat.id, text: t('admin_unauthorized', lang), reply_to_message_id: message.message_id })
    }
    const lang = await getAdminLang(message.from)
    if (await denyIfSafeMode(message, lang, 'maintenance_toggle')) return

    const args = message.text.split(/\s+/)
    const action = (args[1] || '').toLowerCase()
    if (action === 'on') return handleMaintenanceToggle(true, message)
    if (action === 'off') return handleMaintenanceToggle(false, message)

    const current = await db.getCounter('maintenance_mode')
    const statusText = current === 1 ? t('admin_maintenance_status_on', lang) : t('admin_maintenance_status_off', lang)
    return sendMessage({
        chat_id: message.chat.id,
        text: `${t('admin_maintenance_choose', lang)}\n${t('admin_maintenance_status', lang, { STATUS: statusText })}`,
        reply_markup: maintenanceKeyboard(lang),
        reply_to_message_id: message.message_id
    })
}

export async function handleMaintenanceCallback(callbackQuery) {
    const data = callbackQuery?.data || ''
    if (!data.startsWith('admin:maint_')) return false

    const fakeMessage = {
        from: callbackQuery.from,
        chat: callbackQuery.message?.chat || {},
        message_id: callbackQuery.message?.message_id,
        message_thread_id: callbackQuery.message?.message_thread_id,
        text: '/maintenance'
    }

    if (!isGlobalAdminOrOwner(callbackQuery.from.id)) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_unauthorized', getLang(callbackQuery.from)), show_alert: true })
        return true
    }

    const lang = await getAdminLang(callbackQuery.from)
    try {
        if (await denyIfSafeMode(fakeMessage, lang, 'maintenance_toggle')) {
            await answerCallbackQuery(callbackQuery.id, { text: t('admin_safe_mode_blocked', lang), show_alert: true })
            return true
        }

        const enable = data === 'admin:maint_on'
        const current = await db.getCounter('maintenance_mode')
        if ((enable && current === 1) || (!enable && current === 0)) {
            await answerCallbackQuery(callbackQuery.id, {
                text: enable ? t('admin_maintenance_already_on', lang) : t('admin_maintenance_already_off', lang),
                show_alert: false
            })
            return true
        }

        const stmt = d1.prepare("INSERT INTO counters (key, value) VALUES ('maintenance_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        await stmt.bind(enable ? 1 : 0).run()
        await db.addAdminAuditLog({
            admin_id: callbackQuery.from.id,
            action: enable ? 'maintenance_on' : 'maintenance_off',
            target_id: null,
            chat_id: callbackQuery.message?.chat?.id,
            thread_id: callbackQuery.message?.message_thread_id,
            success: true,
            detail: 'inline_button'
        })

        await answerCallbackQuery(callbackQuery.id, {
            text: enable ? t('admin_maintenance_on', lang) : t('admin_maintenance_off', lang),
            show_alert: false
        })

        const statusText = enable ? t('admin_maintenance_status_on', lang) : t('admin_maintenance_status_off', lang)
        await editMessage({
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            text: `${t('admin_maintenance_choose', lang)}\n${t('admin_maintenance_status', lang, { STATUS: statusText })}`,
            reply_markup: maintenanceKeyboard(lang)
        }).catch(() => { })
        return true
    } catch (e) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_error', lang, { MSG: 'callback failed' }), show_alert: false }).catch(() => { })
        return true
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
    const isWhitelisted = await db.isUserWhitelisted(targetUser.user_id)

    const labels = lang === 'zh'
        ? { title: '👤 <b>用户信息</b>', id: 'ID', name: '姓名', username: '用户名', created: '注册时间', status: '状态', blocked: '🔴 已封禁', active: '🟢 正常', white: '白名单' }
        : { title: '👤 <b>User Info</b>', id: 'ID', name: 'Name', username: 'Username', created: 'Created', status: 'Status', blocked: '🔴 Blocked', active: '🟢 Active', white: 'Whitelisted' }

    let info = `${labels.title}\n`
    info += `${labels.id}: <code>${targetUser.user_id}</code>\n`
    info += `${labels.name}: ${escapeHtml(targetUser.first_name)} ${escapeHtml(targetUser.last_name || '')}\n`
    info += `${labels.username}: @${targetUser.username || ''}\n`
    info += `${labels.created}: ${formatTime(targetUser.created_at)}\n`
    info += `${labels.status}: ${isBlocked ? labels.blocked : labels.active}\n`
    info += `${labels.white}: ${isWhitelisted ? '✅' : '❌'}\n`

    await sendMessage({
        chat_id: message.chat.id,
        text: info,
        parse_mode: 'HTML',
        reply_markup: userActionKeyboard(targetUser.user_id, lang, isBlocked, isWhitelisted)
    })
}

export async function handleUserActionCallback(callbackQuery) {
    const data = callbackQuery?.data || ''
    if (!data.startsWith('admin:useract:')) return false

    const lang = await getAdminLang(callbackQuery.from)
    if (!isGlobalAdminOrOwner(callbackQuery.from.id)) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_unauthorized', lang), show_alert: true })
        return true
    }

    const [, , action, uid] = data.split(':')
    if (!uid) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_no_target', lang), show_alert: true })
        return true
    }

    if (config.SAFE_MODE && !isOwner(callbackQuery.from.id) && ['ban', 'unban', 'clear'].includes(action)) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_safe_mode_blocked', lang), show_alert: true })
        return true
    }

    try {
        if (action === 'ban') {
            await db.blockUser(uid, true)
            await db.addAdminAuditLog({ admin_id: callbackQuery.from.id, action: 'callback_ban', target_id: uid, chat_id: callbackQuery.message?.chat?.id, thread_id: callbackQuery.message?.message_thread_id, success: true, detail: 'userinfo_button' })
            await answerCallbackQuery(callbackQuery.id, { text: t('admin_blocked', lang, { UID: uid }), show_alert: false })
        } else if (action === 'unban') {
            await db.blockUser(uid, false)
            await db.blockUserOld(uid, false)
            await db.addAdminAuditLog({ admin_id: callbackQuery.from.id, action: 'callback_unban', target_id: uid, chat_id: callbackQuery.message?.chat?.id, thread_id: callbackQuery.message?.message_thread_id, success: true, detail: 'userinfo_button' })
            await answerCallbackQuery(callbackQuery.id, { text: t('admin_unblocked', lang, { UID: uid }), show_alert: false })
        } else if (action === 'white') {
            await db.addToWhitelist(uid)
            await db.addAdminAuditLog({ admin_id: callbackQuery.from.id, action: 'callback_whitelist', target_id: uid, chat_id: callbackQuery.message?.chat?.id, thread_id: callbackQuery.message?.message_thread_id, success: true, detail: 'userinfo_button' })
            await answerCallbackQuery(callbackQuery.id, { text: t('admin_whitelist_added', lang, { UID: uid }), show_alert: false })
        } else if (action === 'unwhite') {
            await db.removeFromWhitelist(uid)
            await db.addAdminAuditLog({ admin_id: callbackQuery.from.id, action: 'callback_unwhitelist', target_id: uid, chat_id: callbackQuery.message?.chat?.id, thread_id: callbackQuery.message?.message_thread_id, success: true, detail: 'userinfo_button' })
            await answerCallbackQuery(callbackQuery.id, { text: t('admin_whitelist_removed', lang, { UID: uid }), show_alert: false })
        } else if (action === 'clear') {
            const result = await db.clearUserHistory(uid)
            await db.addAdminAuditLog({ admin_id: callbackQuery.from.id, action: 'callback_clear', target_id: uid, chat_id: callbackQuery.message?.chat?.id, thread_id: callbackQuery.message?.message_thread_id, success: true, detail: `logs=${result.deletedLogs},states=${result.deletedStates},maps=${result.deletedMaps}` })
            await answerCallbackQuery(callbackQuery.id, { text: t('admin_clear_done', lang, { UID: uid, LOGS: String(result.deletedLogs), STATES: String(result.deletedStates), MAPS: String(result.deletedMaps) }), show_alert: true })
        } else {
            await answerCallbackQuery(callbackQuery.id, { text: 'Unsupported action', show_alert: false })
        }

        const user = await db.getUser(uid)
        if (user && callbackQuery.message) {
            const blocked = await db.isUserBlocked(uid)
            const whitelisted = await db.isUserWhitelisted(uid)
            const labels = lang === 'zh'
                ? { title: '👤 <b>用户信息</b>', id: 'ID', name: '姓名', username: '用户名', created: '注册时间', status: '状态', blocked: '🔴 已封禁', active: '🟢 正常', white: '白名单' }
                : { title: '👤 <b>User Info</b>', id: 'ID', name: 'Name', username: 'Username', created: 'Created', status: 'Status', blocked: '🔴 Blocked', active: '🟢 Active', white: 'Whitelisted' }
            const info = `${labels.title}\n${labels.id}: <code>${user.user_id}</code>\n${labels.name}: ${escapeHtml(user.first_name)} ${escapeHtml(user.last_name || '')}\n${labels.username}: @${user.username || ''}\n${labels.created}: ${formatTime(user.created_at)}\n${labels.status}: ${blocked ? labels.blocked : labels.active}\n${labels.white}: ${whitelisted ? '✅' : '❌'}\n`
            await editMessage({
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                text: info,
                parse_mode: 'HTML',
                reply_markup: userActionKeyboard(user.user_id, lang, blocked, whitelisted)
            }).catch(() => { })
        }
    } catch (e) {
        await answerCallbackQuery(callbackQuery.id, { text: t('admin_error', lang, { MSG: 'action failed' }), show_alert: true }).catch(() => { })
    }
    return true
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
        const requested = Number.parseInt(args[1] || '1', 10)
        const page = Number.isFinite(requested) ? Math.max(requested, 1) : 1
        return renderListSpamPage({
            lang,
            page,
            chat_id: message.chat.id,
            reply_to_message_id: message.message_id
        })
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

function listSpamKeyboard(page, totalPages) {
    const row = []
    if (page > 1) row.push({ text: '⬅️ Prev', callback_data: `admin:listspam:${page - 1}` })
    row.push({ text: `${page}/${totalPages}`, callback_data: 'admin:listspam:noop' })
    if (page < totalPages) row.push({ text: 'Next ➡️', callback_data: `admin:listspam:${page + 1}` })
    return { inline_keyboard: [row] }
}

async function renderListSpamPage({ lang, page, chat_id, reply_to_message_id = null, message_id = null }) {
    const current = await getSpamKeywords()
    const list = (current || '').split(',').map(k => k.trim()).filter(Boolean)
    if (!list.length) {
        return sendMessage({ chat_id, text: lang === 'zh' ? '垃圾关键词为空。' : 'Spam keyword list is empty.', reply_to_message_id })
    }

    const totalPages = Math.max(1, Math.ceil(list.length / LISTSPAM_BUTTON_PAGE_SIZE))
    const normalizedPage = Math.min(Math.max(page, 1), totalPages)
    const from = (normalizedPage - 1) * LISTSPAM_BUTTON_PAGE_SIZE
    const hardTo = Math.min(list.length, from + LISTSPAM_BUTTON_PAGE_SIZE)

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
        ? `垃圾关键词（第 ${normalizedPage}/${totalPages} 页，显示 ${from + 1}-${shownTo} / 共 ${list.length} 条）\n`
        : `Spam Keywords (Page ${normalizedPage}/${totalPages}, showing ${from + 1}-${shownTo} of ${list.length})\n`

    const payload = {
        chat_id,
        text: `${header}\n${lines.join('\n')}`.slice(0, 3900),
        reply_markup: listSpamKeyboard(normalizedPage, totalPages)
    }
    if (message_id) {
        payload.message_id = message_id
        return editMessage(payload)
    }
    if (reply_to_message_id) payload.reply_to_message_id = reply_to_message_id
    return sendMessage(payload)
}

export async function handleListSpamCallback(callbackQuery) {
    const data = callbackQuery?.data || ''
    if (!data.startsWith('admin:listspam:')) return false
    const lang = await getAdminLang(callbackQuery.from)
    if (data === 'admin:listspam:noop') {
        await answerCallbackQuery(callbackQuery.id, { text: ' ' })
        return true
    }
    try {
        const page = Number.parseInt(data.split(':')[2] || '1', 10)
        await renderListSpamPage({
            lang,
            page: Number.isFinite(page) ? page : 1,
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id
        })
        await answerCallbackQuery(callbackQuery.id, { text: 'OK' })
    } catch {
        await answerCallbackQuery(callbackQuery.id, { text: 'Failed', show_alert: false }).catch(() => { })
    }
    return true
}

export async function handleAuditCommand(message) {
    if (!isGlobalAdminOrOwner(message.from.id)) return
    const lang = await getAdminLang(message.from)
    const args = message.text.split(/\s+/)
    const requested = Number.parseInt(args[1] || '1', 10)
    const page = Number.isFinite(requested) ? Math.max(requested, 1) : 1
    return renderAuditPage({
        lang,
        page,
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id
    })
}

function auditKeyboard(page, totalPages) {
    const row = []
    if (page > 1) row.push({ text: '⬅️ Prev', callback_data: `admin:audit:${page - 1}` })
    row.push({ text: `${page}/${totalPages}`, callback_data: 'admin:audit:noop' })
    if (page < totalPages) row.push({ text: 'Next ➡️', callback_data: `admin:audit:${page + 1}` })
    return { inline_keyboard: [row] }
}

async function renderAuditPage({ lang, page, chat_id, reply_to_message_id = null, message_id = null }) {
    const pageSize = 10
    const total = await db.getAdminAuditLogCount()
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const normalizedPage = Math.min(Math.max(page, 1), totalPages)
    const offset = (normalizedPage - 1) * pageSize
    const rows = await db.getAdminAuditLogs(pageSize, offset)

    if (!rows.length) {
        return sendMessage({ chat_id, text: t('admin_audit_empty', lang), reply_to_message_id })
    }

    const title = lang === 'zh'
        ? `🧾 最近管理员操作（第 ${normalizedPage}/${totalPages} 页）\n${t('admin_audit_page_usage', lang)}\n`
        : `🧾 Recent Admin Actions (Page ${normalizedPage}/${totalPages})\n${t('admin_audit_page_usage', lang)}\n`
    const lines = rows.map(row => {
        const time = new Date(row.created_at).toISOString().slice(11, 19)
        const ok = row.success ? 'OK' : 'FAIL'
        const target = row.target_id ? ` -> ${row.target_id}` : ''
        let detail = row.detail ? ` (${row.detail})` : ''
        if (detail.length > 64) detail = `${detail.slice(0, 64)}...)`
        return `#${row.id} ${time} ${row.action}${target} ${ok}${detail}`
    })

    const payload = {
        chat_id,
        text: `${title}${lines.join('\n')}`.slice(0, 3900),
        reply_markup: auditKeyboard(normalizedPage, totalPages)
    }
    if (message_id) {
        payload.message_id = message_id
        return editMessage(payload)
    }
    if (reply_to_message_id) payload.reply_to_message_id = reply_to_message_id
    return sendMessage(payload)
}

export async function handleAuditCallback(callbackQuery) {
    const data = callbackQuery?.data || ''
    if (!data.startsWith('admin:audit:')) return false
    const lang = await getAdminLang(callbackQuery.from)

    if (data === 'admin:audit:noop') {
        await answerCallbackQuery(callbackQuery.id, { text: ' ' })
        return true
    }

    try {
        const page = Number.parseInt(data.split(':')[2] || '1', 10)
        await renderAuditPage({
            lang,
            page: Number.isFinite(page) ? page : 1,
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id
        })
        await answerCallbackQuery(callbackQuery.id, { text: 'OK' })
    } catch {
        await answerCallbackQuery(callbackQuery.id, { text: 'Failed', show_alert: false }).catch(() => { })
    }
    return true
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
