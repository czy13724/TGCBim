/**
 * Telegram API wrapper
 * Telegram API 包装器
 */
import { config } from '../config.js';

// Global rate limiting state
// 全局速率限制状态
let globalApiCallCount = 0
let rateLimitResetTime = Date.now() + 60000 // 1 minute / 1 分钟
const GLOBAL_RATE_LIMIT = 200

/**
 * Check global rate limit
 * 检查全局速率限制
 */
function checkGlobalRateLimit() {
    const now = Date.now()
    if (now > rateLimitResetTime) {
        globalApiCallCount = 0
        rateLimitResetTime = now + 60000
    }

    if (globalApiCallCount >= GLOBAL_RATE_LIMIT) {
        throw new Error(`Global rate limit exceeded: ${GLOBAL_RATE_LIMIT} requests per minute`)
    }

    globalApiCallCount++
    return true
}

export function getRateLimitStatus() {
    return {
        current_count: globalApiCallCount,
        limit: GLOBAL_RATE_LIMIT,
        reset_in_seconds: Math.max(0, Math.floor((rateLimitResetTime - Date.now()) / 1000)),
        status: globalApiCallCount < GLOBAL_RATE_LIMIT * 0.9 ? '✅ ok' : '⚠️ near limit'
    }
}

function apiUrl(methodName, params = null) {
    let query = ''
    if (params) {
        query = '?' + new URLSearchParams(params).toString()
    }
    return `https://api.telegram.org/bot${config.TOKEN}/${methodName}${query}`
}

export async function requestTelegram(methodName, body, params = null) {
    // Check global rate limit
    // 检查全局速率限制
    try {
        checkGlobalRateLimit()
    } catch (e) {
        console.error('Rate limit exceeded:', e)
        throw e
    }

    const response = await fetch(apiUrl(methodName, params), body)
    const contentType = response.headers.get('content-type') || ''
    const isJson = contentType.includes('application/json')
    if (!response.ok) {
        const errorText = isJson ? JSON.stringify(await response.json()).slice(0, 500) : (await response.text()).slice(0, 500)
        throw new Error(`Telegram API error: ${response.status} ${errorText}`)
    }
    const data = isJson ? await response.json() : await response.text()
    try {
        if (data && data.ok === false) {
            const desc = data.description || 'Unknown error'
            throw new Error(`Telegram API returned ok=false: ${desc}`)
        }
    } catch (e) {
        // if data is text, ignore
        // 如果数据是文本，忽略
    }
    return data
}

function makeReqBody(body) {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(body)
    }
}

export function sendMessage(msg = {}) {
    return requestTelegram('sendMessage', makeReqBody(msg))
}

export function copyMessage(msg = {}) {
    return requestTelegram('copyMessage', makeReqBody(msg))
}

export function forwardMessage(msg = {}) {
    return requestTelegram('forwardMessage', makeReqBody(msg))
}

export function editMessage(msg = {}) {
    return requestTelegram('editMessageText', makeReqBody(msg))
}

export function editMessageCaption(msg = {}) {
    return requestTelegram('editMessageCaption', makeReqBody(msg))
}

export function editMessageReplyMarkup(msg = {}) {
    return requestTelegram('editMessageReplyMarkup', makeReqBody(msg))
}

export function answerCallbackQuery(callback_query_id, options = {}) {
    return requestTelegram('answerCallbackQuery', makeReqBody({
        callback_query_id: callback_query_id,
        ...options
    }))
}

export function deleteMessage(chat_id, message_id) {
    return requestTelegram('deleteMessage', makeReqBody({
        chat_id: chat_id,
        message_id: message_id
    }))
}

export function deleteMessages(chat_id, message_ids) {
    return requestTelegram('deleteMessages', makeReqBody({
        chat_id: chat_id,
        message_ids: message_ids
    }))
}

export function createForumTopic(chat_id, name) {
    return requestTelegram('createForumTopic', makeReqBody({
        chat_id: chat_id,
        name: name
    }))
}

export function closeForumTopic(chat_id, message_thread_id) {
    return requestTelegram('closeForumTopic', makeReqBody({
        chat_id: chat_id,
        message_thread_id: message_thread_id
    }))
}

export function reopenForumTopic(chat_id, message_thread_id) {
    return requestTelegram('reopenForumTopic', makeReqBody({
        chat_id: chat_id,
        message_thread_id: message_thread_id
    }))
}

export function deleteForumTopic(chat_id, message_thread_id) {
    return requestTelegram('deleteForumTopic', makeReqBody({
        chat_id: chat_id,
        message_thread_id: message_thread_id
    }))
}

export function getUserProfilePhotos(user_id, limit = 1) {
    return requestTelegram('getUserProfilePhotos', null, {
        user_id: user_id,
        limit: limit
    })
}

export function sendPhoto(msg = {}) {
    return requestTelegram('sendPhoto', makeReqBody(msg))
}

export function getChatMember(chat_id, user_id) {
    return requestTelegram('getChatMember', null, {
        chat_id: chat_id,
        user_id: user_id
    })
}

export function banChatMember(chat_id, user_id) {
    return requestTelegram('banChatMember', null, {
        chat_id: chat_id,
        user_id: user_id
    })
}

export function kickChatMember(chat_id, user_id) {
    // 踢出用户 = 封禁后解封（从群组移除但允许重新加入）
    // Kick = ban then unban (removes from group but allows rejoin)
    return banChatMember(chat_id, user_id).then(() => {
        return requestTelegram('unbanChatMember', null, {
            chat_id: chat_id,
            user_id: user_id,
            only_if_banned: true
        })
    })
}

export function getMe() {
    return requestTelegram('getMe')
}

// Helper: Get Bot Info (with simple memory cache for the worker execution)
// 助手：获取机器人信息（在 worker 执行期间使用简单的内存缓存）
let botInfoCache = null
export async function getBotInfo() {
    try {
        if (botInfoCache) return botInfoCache
        const response = await requestTelegram('getMe', { method: 'GET' })
        if (response && response.result) {
            botInfoCache = response.result
            return response.result
        }
        return null
    } catch (error) {
        console.error('Error getting bot info:', error)
        return null
    }
}

/**
 * Check if user is a group administrator
 * 检查用户是否为群组管理员
 */
export async function isGroupAdmin(chat_id, user_id) {
    try {
        const response = await getChatMember(chat_id, user_id)
        const result = response
        if (result.ok) {
            const status = result.result.status
            return ['creator', 'administrator'].includes(status)
        }
    } catch (e) {
        console.error('Error checking group admin status:', e)
    }
    return false
}
