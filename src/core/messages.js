/**
 * Message forwarding logic
 * 消息转发逻辑
 */
import { config, isGlobalAdminOrOwner } from '../config.js';
import { db, appendUserLog } from '../services/db.js';
import {
    sendMessage, copyMessage, createForumTopic,
    closeForumTopic, editMessage, editMessageCaption, deleteMessage,
    forwardMessage, reopenForumTopic
} from '../services/telegram.js';
import {
    checkSecurity, updateUserDb, sendContactCard,
    maybeSendDeliveredNotice, handleNotify,
    translateText
} from '../utils/helpers.js';
import { checkSpam, handleSpamDetected } from './spam.js';
import { formatDateKeyUTC } from '../utils/utils.js';
import { getLang, t } from '../services/i18n.js';

// === User to Admin Forwarding ===
// === 用户到管理员转发 ===

export async function forwardMessageU2A(message) {
    const user = message.from
    const chat_id = message.chat.id

    // Check security / block status
    // 检查安全 / 封禁状态
    const securityCheck = await checkSecurity(user.id)
    if (securityCheck.blocked) {
        return // Silently ignore blocked
        // 默默忽略被封禁的用户
    }

    const isBlocked = await db.isUserBlocked(user.id)
    if (isBlocked) {
        // Notify blocked user with cooldown (1 hour) to avoid silent failures or spam.
        // 向被封禁用户发送提示（1小时冷却），避免静默无提示或刷屏。
        try {
            const dbUser = await db.getUser(user.id).catch(() => null)
            const savedLang = await db.getUserState(user.id, 'user_pref_lang').catch(() => null)
            const lang = savedLang === 'zh' || savedLang === 'en' ? savedLang : getLang(dbUser || user)
            const now = Date.now()
            const lastNotifyTs = Number(await db.getUserState(user.id, 'block_notify_ts').catch(() => 0) || 0)
            if (!lastNotifyTs || now - lastNotifyTs > 3600 * 1000) {
                const resp = await sendMessage({ chat_id: chat_id, text: t('user_blocked', lang) })
                if (resp && resp.ok) {
                    await db.setUserState(user.id, 'block_notify_ts', now)
                }
            }
        } catch (e) {
            console.error('Failed to send block notification:', e)
        }
        return
    }


    // Anti-Flood Rate Limiting
    // 防刷屏频率限制
    if (config.ANTI_FLOOD_MESSAGES > 0 && config.ANTI_FLOOD_SECONDS > 0 && !isGlobalAdminOrOwner(user.id)) {
        const floodCount = await db.incrementFloodCount(user.id, config.ANTI_FLOOD_SECONDS);
        if (floodCount > config.ANTI_FLOOD_MESSAGES) {
            if (floodCount === config.ANTI_FLOOD_MESSAGES + 1) {
                // Notify user only once per flood window
                // 每次刷屏窗口只通知用户一次
                await sendMessage({
                    chat_id: chat_id,
                    text: t('msg_flood_warning', getLang(user)) || '⚠️ You are sending messages too fast. Please slow down.'
                });
            }
            return; // Drop message silently
        }
    }

    // Check spam
    // 检查垃圾邮件
    const spamCheck = await checkSpam(message)
    if (spamCheck.isSpam) {
        await handleSpamDetected(message, user, spamCheck)
        return
    }

    // Update user stats
    // 更新用户统计信息
    await updateUserDb(user)

    // Mode selection
    // 模式选择
    if (config.ADMIN_GROUP_ID) {
        return await forwardMessageNewMode(message, user, user.id, chat_id)
    } else {
        return await forwardMessageOldMode(message, user, user.id, chat_id)
    }
}

export async function forwardMessageNewMode(message, user, user_id, chat_id) {
    let userData = await db.getUser(user_id)
    let message_thread_id = userData ? userData.message_thread_id : null
    let topicStatus = message_thread_id ? await db.getTopicStatus(message_thread_id) : null

    // Determine if we need to create a new topic
    // 确定是否需要创建新话题
    let needNewTopic = false

    if (!message_thread_id) {
        needNewTopic = true
    } else if (topicStatus && topicStatus.status === 'closed') {
        // If topic is closed, try to reopen it first
        // 如果话题已关闭，首先尝试重新打开
        try {
            await db.setTopicStatus(message_thread_id, 'opened')
            // Reopen forum topic if supported
            // 如果支持，重新打开论坛话题
            await reopenForumTopic(config.ADMIN_GROUP_ID, message_thread_id)
        } catch (e) {
            console.error('Failed to reopen topic, creating new one', e)
            needNewTopic = true
        }
    } else if (topicStatus && topicStatus.status === 'deleted') {
        needNewTopic = true
    }

    // Create topic if needed
    // 如果需要，创建话题
    if (needNewTopic) {
        try {
            const topicName = `${user.first_name || ''} ${user.last_name || ''} (${user_id})`.trim().slice(0, 128)
            const topic = await createForumTopic(config.ADMIN_GROUP_ID, topicName)

            if (topic.ok && topic.result) {
                message_thread_id = topic.result.message_thread_id

                // Save topic info
                // 保存话题信息
                await db.setTopicStatus(message_thread_id, 'opened', {
                    created_at: Date.now(),
                    created_by_user: user_id,
                    topic_name: topicName
                })

                // Update user data with new thread ID
                // 使用新话题 ID 更新用户数据
                if (userData) {
                    userData.message_thread_id = message_thread_id
                    await db.setUser(user_id, userData)
                }

                // Send contact card to the new topic
                // 发送联系人卡片到新话题
                await sendContactCard(config.ADMIN_GROUP_ID, message_thread_id, user)
            } else {
                throw new Error('Failed to create topic: ' + JSON.stringify(topic))
            }
        } catch (e) {
            console.error('Error creating topic:', e)
            await sendMessage({ chat_id: config.ADMIN_UID, text: `⚠️ Failed to create topic for ${user_id}: ${e.message}` })
            return
        }
    }

    // Forward the message to the topic
    // 将消息转发到话题
    try {
        const copyResult = await copyMessage({
            chat_id: config.ADMIN_GROUP_ID,
            from_chat_id: chat_id,
            message_id: message.message_id,
            message_thread_id: message_thread_id
        })

        if (copyResult.ok) {
            const sentMsgId = copyResult.result.message_id

            // Log activity
            // 记录活动
            await appendUserLog(user_id, 'u2a', message, formatDateKeyUTC)

            // Map messages for reply/edit handling
            // 映射消息以处理回复/编辑
            await db.setMessageMap(`u2a:${message.message_id}`, sentMsgId)
            await db.setMessageMap(`a2u:${sentMsgId}`, message.message_id)

            // Handle notification logic
            // 处理通知逻辑
            await handleNotify(message)

            // Auto-translate if enabled
            // 如果启用，自动翻译
            if (config.ENABLE_AUTO_TRANSLATE && message.text) {
                const translated = await translateText(message.text)
                if (translated) {
                    await sendMessage({
                        chat_id: config.ADMIN_GROUP_ID,
                        message_thread_id: message_thread_id,
                        text: `🔄 ${translated}`,
                        reply_to_message_id: sentMsgId
                    })
                }
            }

            // Save routing data if it's a group message so A2U can reply to it later
            if (message.chat.type !== 'private') {
                await db.setUserState(user_id, 'group_msg:' + sentMsgId, {
                    chat_id: chat_id,
                    message_id: message.message_id
                });
            } else {
                // Send delivered notice if applicable (omitted for group messages to prevent spam)
                await maybeSendDeliveredNotice(user_id, chat_id, user, {
                    text: t('msg_delivered', getLang(user))
                })
            }
        }
    } catch (e) {
        console.error('Error forwarding to topic:', e)
    }
}

export async function forwardMessageOldMode(message, user, user_id, chat_id) {
    if (!config.ADMIN_UID) {
        console.error('ADMIN_UID is not configured; cannot forward in legacy mode.')
        await sendMessage({
            chat_id,
            text: 'Service is temporarily unavailable. Please try again later.'
        }).catch(() => { })
        return
    }

    let sentMsgId = null;

    try {
        let fwdResult = await forwardMessage({
            chat_id: config.ADMIN_UID,
            from_chat_id: chat_id,
            message_id: message.message_id
        })
        if (fwdResult.ok && fwdResult.result) {
            sentMsgId = fwdResult.result.message_id;
        }
    } catch (fw_err) {
        console.error('forwardMessage failed, trying copyMessage:', fw_err.message)

        try {
            let copyRes = await copyMessage({
                chat_id: config.ADMIN_UID,
                from_chat_id: chat_id,
                message_id: message.message_id
            })

            if (copyRes.ok && copyRes.result) {
                sentMsgId = copyRes.result.message_id;
                // Send a small context note so admin knows who it's from since copyMessage strips the header
                await sendMessage({
                    chat_id: config.ADMIN_UID,
                    text: `👤 Message from: ${user.first_name || 'User'} (<code>${user_id}</code>)`,
                    parse_mode: 'HTML',
                    reply_to_message_id: sentMsgId
                })
            }
        } catch (copy_err) {
            console.error('copyMessage also failed:', copy_err.message)
            await sendMessage({
                chat_id: config.ADMIN_UID,
                text: `⚠️ Message delivery failed from ${user_id}: ${copy_err.message || 'Unknown error'}`
            }).catch(e => console.error('Failed to send error alert', e));
        }
    }

    if (sentMsgId) {
        try {
            // Map for legacy reply support
            // 映射以支持旧版回复
            await db.setOldMessageMap(sentMsgId, user_id)

            // Log activity
            // 记录活动
            await appendUserLog(user_id, 'u2a', message, formatDateKeyUTC)

            // Handle notification
            // 处理通知
            await handleNotify(message)

            // Save routing data if it's a group message so A2U can reply to it later
            if (message.chat.type !== 'private') {
                await db.setUserState(user_id, 'group_msg:' + sentMsgId, {
                    chat_id: chat_id,
                    message_id: message.message_id
                });
            } else {
                // Send delivered notice (omitted for group messages)
                await maybeSendDeliveredNotice(user_id, chat_id, user, {
                    text: t('msg_delivered_admin', getLang(user))
                })
            }
        } catch (e) {
            console.error('Error forwarding old mode:', e)
        }
    }
}

// === Admin to User Forwarding ===
// === 管理员到用户转发 ===

export async function forwardMessageA2U(message) {
    const message_thread_id = message.message_thread_id

    // Ensure we are in the admin group
    // 确保我们在管理群组中
    if (config.ADMIN_GROUP_ID && message.chat.id.toString() === config.ADMIN_GROUP_ID) {

        // Ignore commands
        // 忽略命令
        if (message.text && message.text.startsWith('/')) return

        // Determine target user from thread ID
        // 根据话题 ID 确定目标用户
        let target_user = null
        if (message_thread_id) {
            target_user = await db.findUserByThreadId(message_thread_id)
        }

        if (!target_user) return // Message in unknown topic

        // Check if this is a reply to a message that originated from a group
        let target_chat_id = target_user.user_id;
        let reply_msg_id = undefined;

        if (message.reply_to_message && message.reply_to_message.message_id) {
            const state = await db.getUserState(target_user.user_id, 'group_msg:' + message.reply_to_message.message_id);
            if (state && state.chat_id) {
                target_chat_id = state.chat_id;
                reply_msg_id = state.message_id;
            }
        }

        // Send copy to user (or group)
        // 发送副本给用户（或群组）
        try {
            const copyResult = await copyMessage({
                chat_id: target_chat_id,
                from_chat_id: message.chat.id,
                message_id: message.message_id,
                reply_to_message_id: reply_msg_id
            })

            if (copyResult.ok) {
                const sentMsgId = copyResult.result.message_id

                // Log activity
                // 记录活动
                await appendUserLog(target_user.user_id, 'a2u', message, formatDateKeyUTC)

                // Map messages
                // 映射消息
                await db.setMessageMap(`a2u:${message.message_id}`, sentMsgId)
                await db.setMessageMap(`u2a:${sentMsgId}`, message.message_id)
            } else {
                // Notify admin of failure
                // 通知管理员失败
                await sendMessage({
                    chat_id: message.chat.id,
                    message_thread_id: message_thread_id,
                    text: t('msg_send_failed', getLang(message.from)),
                    reply_to_message_id: message.message_id
                })
            }
        } catch (e) {
            console.error('Error A2U:', e)
            await sendMessage({
                chat_id: message.chat.id,
                message_thread_id: message_thread_id,
                text: t('msg_send_error', getLang(message.from), { ERROR: e.message }),
                reply_to_message_id: message.message_id
            })
        }
    }
}

export async function handleOldModeAdminReply(message) {
    if (!message.reply_to_message) return false

    // Check if reply to a forwarded message
    // 检查是否回复转发的消息
    const targetUserId = await db.getOldMessageMap(message.reply_to_message.message_id)
    if (!targetUserId) return false

    // Check if command
    // 检查是否为命令
    if (message.text && message.text.startsWith('/')) return false

    // Check if this is a reply to a message that originated from a group
    let targetChatId = targetUserId;
    let replyMsgId = undefined;

    const state = await db.getUserState(targetUserId, 'group_msg:' + message.reply_to_message.message_id);
    if (state && state.chat_id) {
        targetChatId = state.chat_id;
        replyMsgId = state.message_id;
    }

    // Send copy to user (or group)
    // 发送副本给用户（或群组）
    try {
        const copyResult = await copyMessage({
            chat_id: targetChatId,
            from_chat_id: message.chat.id,
            message_id: message.message_id,
            reply_to_message_id: replyMsgId
        })

        if (copyResult.ok) {
            // Persist mapping for continuity
            // 持久化映射以保持连续性
            await db.setOldMessageMap(message.message_id, targetUserId)
            await appendUserLog(targetUserId, 'a2u', message, formatDateKeyUTC)
            return true
        }
    } catch (e) {
        console.error('Error Old Mode Reply:', e)
        await sendMessage({
            chat_id: message.chat.id,
            text: t('msg_send_error', getLang(message.from), { ERROR: e.message }),
            reply_to_message_id: message.message_id
        })
        return true
    }
    return false
}

export async function handleEditedMessage(message, isPrivate) {
    // If user edits message, try to edit the forwarded copy
    // 如果用户编辑消息，尝试编辑转发的副本
    if (isPrivate) {
        // User edited
        // 用户已编辑
        const adminMsgId = await db.getMessageMap(`u2a:${message.message_id}`)
        if (adminMsgId) {
            try {
                if (message.text) {
                    await editMessage({
                        chat_id: config.ADMIN_GROUP_ID || config.ADMIN_UID,
                        message_id: adminMsgId,
                        text: message.text
                    })
                } else if (message.caption) {
                    await editMessageCaption({
                        chat_id: config.ADMIN_GROUP_ID || config.ADMIN_UID,
                        message_id: adminMsgId,
                        caption: message.caption
                    })
                }
            } catch (e) {
                // Ignore editing errors (e.g. too old)
                // 忽略编辑错误（例如太旧）
            }
        }
    } else {
        // Admin edited
        // 管理员已编辑
        const userMsgId = await db.getMessageMap(`a2u:${message.message_id}`)
        if (userMsgId) {
            let targetUserId = null
            if (message.message_thread_id) {
                // Find user by thread ID to get chat_id
                // 通过话题 ID 查找用户以获取 chat_id
                const user = await db.findUserByThreadId(message.message_thread_id)
                if (user) targetUserId = user.user_id
            }

            if (targetUserId) {
                try {
                    if (message.text) {
                        await editMessage({
                            chat_id: targetUserId,
                            message_id: userMsgId,
                            text: message.text
                        })
                    } else if (message.caption) {
                        await editMessageCaption({
                            chat_id: targetUserId,
                            message_id: userMsgId,
                            caption: message.caption
                        })
                    }
                } catch (e) { }
            }
        }
    }
}
