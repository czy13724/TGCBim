/**
 * Main Update Handler
 * 主更新处理程序
 */
import { config, isGlobalAdminOrOwner, isOwner } from '../config.js';
import { db, d1 } from '../services/db.js';
import { requestTelegram, sendMessage, answerCallbackQuery, getRateLimitStatus, isGroupAdmin } from '../services/telegram.js';
import { handleStart, handleBroadcastCommand, handleBlockCommand, handleUnblockCommand, handleCheckBlockCommand, handleClearCommand, handleCloseCommand, handleReopenCommand, handleStatsCommand, handleHelpCommand, handleMaintenanceCommand, handleTemplateCommand, handleUserInfoCommand, handleUidCommand, handleSpamCommand, handleWhitelistCommand, handleLangCommand, handleLangCallback, handleAuditCommand, handleMaintenanceCallback, handleAuditCallback } from '../commands/index.js';
import { forwardMessageU2A, forwardMessageA2U, handleOldModeAdminReply, handleEditedMessage } from './messages.js';
import { handleGroupSpam } from './spam.js';
import { checkInactiveTopics, handleBotMentionOrReply } from '../utils/helpers.js';
import { handleVerification, handleVerificationCallback } from './verification.js';
import { getLang, t } from '../services/i18n.js';


export async function onUpdate(update, extra = {}) {
    try {
        // Scheduled cleanup (probabilistic)
        // 定时清理（概率性）
        if (Math.random() < 0.1) {
            checkInactiveTopics().catch(e => console.error('Cleanup error:', e))
        }

        if (update.message) {
            const message = update.message

            // Normalize media captions to text and entities for uniform command/mention handling
            // 将媒体标题规范化为文本和实体，以统一处理命令/提及
            if (!message.text && message.caption) {
                message.text = message.caption
            }
            if (!message.entities && message.caption_entities) {
                message.entities = message.caption_entities
            }

            const user = message.from
            const chat_id = message.chat.id
            const messageText = message.text || ''

            // 1. Handle Start
            // 1. 处理开始
            if (messageText === '/start') {
                return await handleStart(message)
            }

            const isCommand = messageText.startsWith('/')

            // 2. Admin & Group Admin Logic
            // 2. 管理员和群组管理员逻辑
            if (isGlobalAdminOrOwner(user.id) || (isCommand && config.ADMIN_GROUP_ID && chat_id.toString() === config.ADMIN_GROUP_ID)) {

                let hasPermission = isGlobalAdminOrOwner(user.id)
                if (!hasPermission && isCommand && config.ADMIN_GROUP_ID && chat_id.toString() === config.ADMIN_GROUP_ID) {
                    if (config.GROUP_ADMIN_PERMISSIONS) {
                        hasPermission = await isGroupAdmin(chat_id, user.id)
                    }
                }

                if (hasPermission) {
                    // Normalize command
                    // 标准化命令
                    let commandParts = messageText.trim().split(/\s+/)
                    let command = commandParts[0].toLowerCase().split('@')[0]

                    switch (command) {
                        case '/clear': return await handleClearCommand(message)
                        case '/broadcast':
                            message.waitUntil = extra.waitUntil
                            return await handleBroadcastCommand(message)
                        case '/block':
                        case '/ban': return await handleBlockCommand(message)
                        case '/unblock':
                        case '/unban': return await handleUnblockCommand(message)
                        case '/checkblock': return await handleCheckBlockCommand(message)
                        case '/uid': return await handleUidCommand(message)
                        case '/close': return await handleCloseCommand(message)
                        case '/reopen': return await handleReopenCommand(message)
                        case '/stats': return await handleStatsCommand(message)
                        case '/help': return await handleHelpCommand(message)
                        case '/maintenance':
                            if (!isGlobalAdminOrOwner(user.id)) {
                                const lang = getLang(user)
                                return sendMessage({ chat_id, text: t('admin_unauthorized', lang), reply_to_message_id: message.message_id })
                            }
                            return await handleMaintenanceCommand(message)
                        case '/userinfo': return await handleUserInfoCommand(message)
                        case '/whitelist': return await handleWhitelistCommand(message)
                        case '/white':
                            // Quick alias: reply to user message → add to whitelist
                            message.text = '/whitelist add'
                            return await handleWhitelistCommand(message)
                        case '/unwhite':
                            // Quick alias: reply to user message → remove from whitelist
                            message.text = '/whitelist remove'
                            return await handleWhitelistCommand(message)
                        case '/listadmins': {
                            const adminsList = config.ADMINS ? config.ADMINS.split(',').map(id => id.trim()).filter(Boolean) : []
                            const isZh = getLang(user) === 'zh'
                            let adminText = isZh ? '👥 <b>Bot 管理员</b>\n\n' : '👥 <b>Bot Administrators</b>\n\n'
                            adminText += (isZh ? '👑 <b>所有者：</b>' : '👑 <b>Owner:</b>') + ` <code>${config.ADMIN_UID}</code>\n\n`
                            if (adminsList.length > 0) {
                                adminText += (isZh ? '🔧 <b>全局管理员：</b>\n' : '🔧 <b>Global Admins:</b>\n')
                                adminsList.forEach(id => adminText += `  • <code>${id}</code>\n`)
                            } else {
                                adminText += isZh ? '🔧 <b>全局管理员：</b> <i>无</i>\n' : '🔧 <b>Global Admins:</b> <i>None</i>\n'
                            }
                            return sendMessage({ chat_id, text: adminText, parse_mode: 'HTML', reply_to_message_id: message.message_id })
                        }
                        case '/lang': return await handleLangCommand(message)
                        case '/audit': return await handleAuditCommand(message)
                    }


                    // Template commands
                    // 模板命令
                    if (command.startsWith('/tpl')) {
                        return await handleTemplateCommand(message)
                    }

                    // Spam configuration commands (Admin Group or Global)
                    // 垃圾邮件配置命令（管理群组或全局）
                    if (['/addspam', '/removespam', '/listspam', '/checkspam', '/spamstats', '/refreshspam'].includes(command)) {
                        return await handleSpamCommand(message, command)
                    }
                }
            }

            // 3. Global Admin specific
            // 3. 全局管理员特定
            if (isGlobalAdminOrOwner(user.id)) {
                if (!config.ADMIN_GROUP_ID && message.chat.type === 'private') {
                    const replied = await handleOldModeAdminReply(message)
                    if (replied) return
                }
            }

            // 5. Group Messages (Spam / Mentions)
            // 5. 群组消息（垃圾邮件 / 提及）
            if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
                if (await handleGroupSpam(message)) return
                if (await handleBotMentionOrReply(message)) return
            }

            // 6. Private Messages (User -> Admin)
            // 6. 私聊消息（用户 -> 管理员）
            if (message.chat.type === 'private') {
                // If maintenance mode
                // 如果处于维护模式
                if (await db.getCounter('maintenance_mode') === 1 && !isGlobalAdminOrOwner(user.id)) {
                    return sendMessage({ chat_id, text: config.MAINTENANCE_MESSAGE })
                }

                // Admins in private mode: already handled above (old mode reply)
                // If they reach here, they sent a non-reply message — silently ignore it
                // 管理员私聊：已在上方处理（旧版回复），若到达这里说明不是回复消息，静默忽略
                if (isGlobalAdminOrOwner(user.id)) return

                // Human verification & Whitelist for non-admins
                if (!isGlobalAdminOrOwner(user.id)) {
                    const verified = await handleVerification(message, user);
                    if (verified) return; // intercepted by verification logic
                }

                return await forwardMessageU2A(message)
            }

            // 7. Admin Group Messages (Admin -> User)
            // 7. 管理群组消息（管理员 -> 用户）
            if (config.ADMIN_GROUP_ID && chat_id.toString() === config.ADMIN_GROUP_ID) {
                return await forwardMessageA2U(message)
            }
        }

        // Edited messages
        // 编辑的消息
        if (update.edited_message) {
            const em = update.edited_message
            if (em.chat.type === 'private') {
                return await handleEditedMessage(em, true)
            }
            if (config.ADMIN_GROUP_ID && em.chat.id.toString() === config.ADMIN_GROUP_ID) {
                return await handleEditedMessage(em, false)
            }
        }

        // Callback queries
        // 内联按钮回调
        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;

            if (callbackQuery.data?.startsWith('admin:maint_')) {
                await handleMaintenanceCallback(callbackQuery)
                return
            }

            if (callbackQuery.data?.startsWith('admin:audit:')) {
                await handleAuditCallback(callbackQuery)
                return
            }

            // Admin Actions
            if (data && data.startsWith('admin:')) {
                const isAdmin = isGlobalAdminOrOwner(callbackQuery.from.id) ||
                    (config.ADMIN_GROUP_ID && await isGroupAdmin(config.ADMIN_GROUP_ID, callbackQuery.from.id));

                    if (isAdmin) {
                        if (config.SAFE_MODE && !isOwner(callbackQuery.from.id)) {
                            const adminLang = getLang(callbackQuery.from)
                            await db.addAdminAuditLog({
                                admin_id: callbackQuery.from.id,
                                action: 'admin_callback_blocked',
                                target_id: null,
                                chat_id: callbackQuery.message?.chat?.id,
                                thread_id: callbackQuery.message?.message_thread_id,
                                success: false,
                                detail: `safe_mode:${callbackQuery.data}`
                            })
                            await answerCallbackQuery(callbackQuery.id, {
                                text: t('admin_safe_mode_blocked', adminLang),
                                show_alert: true
                            });
                            return;
                        }
                        const parts = data.split(':');
                        const action = parts[1];
                        const targetUid = parts[2];
                    const adminDbUser = await db.getUser(callbackQuery.from.id).catch(() => null)
                    const adminLang = getLang(adminDbUser || callbackQuery.from)

                    if (action === 'ban') {
                        await db.blockUser(targetUid, true);
                        await db.addAdminAuditLog({
                            admin_id: callbackQuery.from.id,
                            action: 'callback_ban',
                            target_id: targetUid,
                            chat_id: callbackQuery.message?.chat?.id,
                            thread_id: callbackQuery.message?.message_thread_id,
                            success: true,
                            detail: 'inline_button'
                        })
                        await answerCallbackQuery(callbackQuery.id, {
                            text: t('admin_blocked', adminLang, { UID: targetUid }),
                            show_alert: true
                        });
                    } else if (action === 'whitelist') {
                        await db.addToWhitelist(targetUid);
                        await db.addAdminAuditLog({
                            admin_id: callbackQuery.from.id,
                            action: 'callback_whitelist',
                            target_id: targetUid,
                            chat_id: callbackQuery.message?.chat?.id,
                            thread_id: callbackQuery.message?.message_thread_id,
                            success: true,
                            detail: 'inline_button'
                        })
                        await answerCallbackQuery(callbackQuery.id, {
                            text: t('admin_whitelist_added', adminLang, { UID: targetUid }),
                            show_alert: true
                        });
                    } else {
                        await answerCallbackQuery(callbackQuery.id, {
                            text: 'Unsupported action',
                            show_alert: false
                        });
                    }
                } else {
                    const adminLang = getLang(callbackQuery.from)
                    await answerCallbackQuery(callbackQuery.id, {
                        text: t('admin_unauthorized', adminLang),
                        show_alert: true
                    });
                }
                return;
            }

            // Route admin_lang callbacks (language preference toggle)
            // 路由语言偏好切换回调
            if (callbackQuery.data?.startsWith('admin_lang:')) {
                await handleLangCallback(callbackQuery)
                return
            }

            // Route verification callbacks
            const verifyResult = await handleVerificationCallback(callbackQuery);
            if (verifyResult && verifyResult.success && verifyResult.pending_message) {
                // Instantly forward their original message
                await forwardMessageU2A(verifyResult.pending_message);
            }
            return;

        }

    } catch (error) {
        console.error('Error processing update:', error)
        try {
            if (config.ADMIN_UID) {
                await sendMessage({
                    chat_id: config.ADMIN_UID,
                    text: `Critical Error: ${error.message}\nTime: ${new Date().toISOString()}`
                })
            }
        } catch (e) { }
    }
}

export async function handleWebhook(event) {
    try {
        const request = event.request
        // Check secret
        // 检查密钥
        const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
        if (config.SECRET && secret !== config.SECRET) {
            return new Response('Unauthorized', { status: 403 })
        }

        const update = await request.json()
        if (event.waitUntil) {
            // Pass waitUntil down to onUpdate
            // 将 waitUntil 传递给 onUpdate
            event.waitUntil(onUpdate(update, { waitUntil: (p) => event.waitUntil(p) }))
        } else {
            await onUpdate(update)
        }

        return new Response('Ok')
    } catch (e) {
        console.error('Webhook error:', e)
        return new Response('Error', { status: 500 })
    }
}

export async function registerWebhook(requestUrl) {
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${config.BASE_PATH}${config.WEBHOOK}`
    try {
        const r = await requestTelegram('setWebhook', null, {
            url: webhookUrl,
            secret_token: config.SECRET,
            allowed_updates: JSON.stringify(['message', 'edited_message', 'callback_query']),
            drop_pending_updates: true
        })
        return new Response(JSON.stringify(r, null, 2), { headers: { 'content-type': 'application/json' } })
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

export async function unRegisterWebhook() {
    try {
        const r = await requestTelegram('deleteWebhook', { drop_pending_updates: true })
        return new Response(JSON.stringify(r), { status: 200 })
    } catch (e) {
        return new Response('Error', { status: 500 })
    }
}

export async function handleHealthCheck() {
    const limits = getRateLimitStatus()
    return new Response(JSON.stringify({
        status: 'healthy',
        limits,
        config: {
            mode: config.ADMIN_GROUP_ID ? 'topic' : 'legacy',
            bot_token_set: !!config.TOKEN,
            d1_set: !!d1,
            admin_uid_set: !!config.ADMIN_UID
        }
    }, null, 2), { headers: { 'content-type': 'application/json' } })
}
