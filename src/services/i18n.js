/**
 * Internationalization (i18n) support
 * 国际化（i18n）支持
 */

// Dictionary containing translations
const dict = {
    // Verification Feature
    verify_pending: {
        en: "⚠️ Please complete the math verification using the buttons below first.",
        zh: "⚠️ 请先通过下方按钮完成验证。"
    },
    verify_expired: {
        en: "Verification expired, generating new one...",
        zh: "验证已过期，正在生成新验证..."
    },
    verify_select_first: {
        en: "Please select an answer first.",
        zh: "请先选择一个答案。"
    },
    verify_success_alert: {
        en: "Success!",
        zh: "验证成功！"
    },
    verify_success_msg: {
        en: "✅ Verification successful! You can now send messages.",
        zh: "✅ 验证成功！您可以开始发送消息了。"
    },
    verify_failed_alert: {
        en: "Incorrect!",
        zh: "答案错误！"
    },
    verify_failed_msg: {
        en: "❌ Incorrect answer. You have {LEFT} attempt(s) remaining.",
        zh: "❌ 答案错误，您还有 {LEFT} 次机会。"
    },
    verify_banned: {
        en: "🚫 Verification failed 3 times.\n\nYou are temporarily blocked for {TIME}. Please try again later.",
        zh: "🚫 您已连续验证失败3次。\n\n您已被临时封禁 {TIME}，请稍后重试。"
    },
    verify_title: {
        en: "🤖 <b>Anti-spam Verification</b>\n\nTo continue, please solve:\n\n<b>{A} {OP} {B} = ?</b>\n\n<i>Select the correct answer, then click Confirm.</i>",
        zh: "🤖 <b>防垃圾消息验证</b>\n\n为了继续操作，请计算：\n\n<b>{A} {OP} {B} = ?</b>\n\n<i>请选择正确答案，然后点击确认。</i>"
    },
    verify_confirm_btn: {
        en: "✅ Confirm",
        zh: "✅ 确认提交"
    },

    // Spam Feature
    spam_blocked: {
        en: "🚫 Your message has been flagged as spam and you have been blocked.",
        zh: "🚫 您的消息已被标记为垃圾信息，您已被封禁。"
    },
    spam_warning: {
        en: "⚠️ Your message was flagged as spam ({COUNT}/{THRESHOLD}). Continued violations will lead to a block.",
        zh: "⚠️ 您的消息被判定为垃圾信息（{COUNT}/{THRESHOLD}）。继续违规将被封禁。"
    },
    user_blocked: {
        en: "🚫 You have been blocked by the administrator and cannot send messages.",
        zh: "🚫 您已被管理员封禁，无法发送消息。"
    },

    // Message Forwarding
    msg_delivered: {
        en: "✅ Message sent to support.",
        zh: "✅ 消息已发送给客服。"
    },
    msg_delivered_admin: {
        en: "✅ Message sent to admin.",
        zh: "✅ 消息已发送给管理员。"
    },
    msg_send_failed: {
        en: "❌ Failed to send message. User might have blocked the bot.",
        zh: "❌ 消息发送失败，用户可能已屏蔽该机器人。"
    },
    msg_send_error: {
        en: "❌ Error: {ERROR}",
        zh: "❌ 错误：{ERROR}"
    },
    msg_flood_warning: {
        en: "⚠️ You are sending messages too fast. Please slow down.",
        zh: "⚠️ 您的发送频率过快，请稍后再试。"
    },
    msg_offline_auto_reply: {
        en: "💤 The admin is currently offline (outside business hours). Your message has been recorded and will be replied to as soon as possible.",
        zh: "💤 客服目前已下班/休息，您的留言已记录，我们会在看到后第一时间回复您。"
    },
    start_fallback: {
        en: "👋 Hi {NAME}! Welcome to {BOT}.\n\nSend me a message and I will forward it to the admin.",
        zh: "👋 你好，{NAME}！欢迎使用 {BOT}。\n\n你可以直接发送消息，我会转发给管理员。"
    },

    // KV Storage Limits
    kv_limit_msg: {
        en: "Sorry, due to system storage limits, your message cannot be delivered at the moment.\n\nThe recipient has been notified. Please try again tomorrow or wait for the issue to be resolved.\n\nFor urgent matters, please contact directly.",
        zh: "抱歉，由于系统存储限制，您的消息暂时无法送达。\n\n已通知接收方。请明天重试或等待问题解决。\n\n如有急事，请直接联系。"
    },

    // ── Admin Command Responses ──────────────────────────────────────
    admin_unauthorized: { en: 'Unauthorized', zh: '未授权' },
    admin_no_target: { en: 'No target found.', zh: '未找到目标用户。' },
    admin_user_not_found: { en: 'User not found.', zh: '未找到该用户。' },
    admin_user_not_found_topic: { en: 'User not found for this topic.', zh: '该话题没有对应的用户。' },
    admin_topic_only: { en: '⚠️ This command only works in topic mode (Group Mode).', zh: '⚠️ 此命令仅适用于话题模式（群组模式）。' },
    admin_topic_closed: { en: 'Topic closed.', zh: '话题已关闭。' },
    admin_topic_reopened: { en: 'Topic reopened.', zh: '话题已重新开启。' },
    admin_error: { en: 'Error: {MSG}', zh: '错误：{MSG}' },
    admin_block_usage: { en: 'Usage: /{CMD} (reply | topic | <id>)', zh: '用法：/{CMD}（回复 | 话题 | <id>）' },
    admin_block_self: { en: "Can't block admin/owner.", zh: '无法封禁管理员/所有者。' },
    admin_blocked: { en: '🚫 User {UID} blocked.', zh: '🚫 用户 {UID} 已封禁。' },
    admin_unblocked: { en: '✅ User {UID} unblocked.', zh: '✅ 用户 {UID} 已解封。' },
    admin_check_block: { en: 'User {UID}:\nBlocked: {STATUS}', zh: '用户 {UID}：\n封禁状态：{STATUS}' },
    admin_log_cleared: { en: "✅ Today's log cleared.", zh: '✅ 今日日志已清除。' },
    admin_log_clear_error: { en: 'Error clearing logs: {MSG}', zh: '清除日志失败：{MSG}' },
    admin_maintenance_on: { en: '🛠 Maintenance mode ON', zh: '🛠 维护模式已开启' },
    admin_maintenance_off: { en: '✅ Maintenance mode OFF', zh: '✅ 维护模式已关闭' },
    admin_maintenance_usage: { en: 'Usage: /maintenance on | /maintenance off', zh: '用法：/maintenance on | /maintenance off' },
    admin_tpl_saved: { en: "Template '{KEY}' saved.", zh: "模板 '{KEY}' 已保存。" },
    admin_tpl_deleted: { en: "Template '{KEY}' deleted.", zh: "模板 '{KEY}' 已删除。" },
    admin_tpl_empty: { en: 'No templates found.', zh: '暂无模板。' },
    admin_tpl_not_found: { en: 'Template not found: {KEY}', zh: '未找到模板：{KEY}' },
    admin_tpl_usage: { en: 'Usage: /tpl add <k> <v> | del <k> | list | <k>', zh: '用法：/tpl add <键> <值> | del <键> | list | <键>' },
    admin_uid_not_found: { en: 'UID not found. Usage: /uid (reply | @username | <id>)', zh: '未找到 UID。用法：/uid（回复 | @用户名 | <id>）' },
    admin_username_not_found: { en: 'Username @{USERNAME} not found in database.', zh: '数据库中未找到用户名 @{USERNAME}。' },
    admin_whitelist_added: { en: '✅ Added {UID} to whitelist.', zh: '✅ 用户 {UID} 已加入白名单。' },
    admin_whitelist_removed: { en: '✅ Removed {UID} from whitelist.', zh: '✅ 用户 {UID} 已移出白名单。' },
    admin_whitelist_usage_add: { en: 'Usage: /whitelist add <id> or reply to a user message.', zh: '用法：/whitelist add <id>，或回复用户消息。' },
    admin_whitelist_usage_add2: { en: 'Usage: /whitelist add <id>', zh: '用法：/whitelist add <id>' },
    admin_whitelist_usage_remove: { en: 'Usage: /whitelist remove <id> or reply to a user message.', zh: '用法：/whitelist remove <id>，或回复用户消息。' },
    admin_whitelist_usage_remove2: { en: 'Usage: /whitelist remove <id>', zh: '用法：/whitelist remove <id>' },
    admin_whitelist_empty: { en: 'Empty', zh: '（空）' },
    admin_whitelist_usage: { en: 'Usage: /whitelist add <id> | remove <id> | list', zh: '用法：/whitelist add <id> | remove <id> | list' },
    admin_spam_usage_add: { en: 'Usage: /addspam <keyword>', zh: '用法：/addspam <关键词>' },
    admin_spam_exists: { en: 'Exists.', zh: '已存在。' },
    admin_spam_added: { en: "Added '{KW}'.", zh: "已添加「{KW}」。" },
    admin_spam_usage_remove: { en: 'Usage: /removespam <keyword>', zh: '用法：/removespam <关键词>' },
    admin_spam_not_found: { en: 'Not found.', zh: '未找到。' },
    admin_spam_removed: { en: "Removed '{KW}'.", zh: "已删除「{KW}」。" },
    admin_spam_refreshing: { en: '🔄 Refreshing remote blocklist...', zh: '🔄 正在刷新远程关键词列表...' },
    admin_spam_refreshed: { en: '✅ Blocklist refreshed! Total keywords: {COUNT}', zh: '✅ 关键词列表已刷新！当前共有 {COUNT} 个关键词' },
    admin_spam_refresh_fail: { en: '❌ Refresh failed: {MSG}', zh: '❌ 刷新失败：{MSG}' },
    admin_safe_mode_blocked: { en: '🛡 SAFE_MODE is enabled. This command is owner-only.', zh: '🛡 已开启 SAFE_MODE。该命令仅限所有者执行。' },
    admin_audit_empty: { en: 'No admin audit logs yet.', zh: '暂无管理员审计日志。' },
    admin_maintenance_choose: { en: 'Choose maintenance mode action:', zh: '请选择维护模式操作：' },
    admin_maintenance_btn_on: { en: 'Turn ON', zh: '开启维护' },
    admin_maintenance_btn_off: { en: 'Turn OFF', zh: '关闭维护' },
    admin_maintenance_status: { en: 'Current status: {STATUS}', zh: '当前状态：{STATUS}' },
    admin_maintenance_status_on: { en: 'ON', zh: '开启' },
    admin_maintenance_status_off: { en: 'OFF', zh: '关闭' },
    admin_maintenance_already_on: { en: 'Maintenance is already ON.', zh: '维护模式已经是开启状态。' },
    admin_maintenance_already_off: { en: 'Maintenance is already OFF.', zh: '维护模式已经是关闭状态。' },
    admin_audit_page_usage: { en: 'Usage: /audit [page], 10 records per page.', zh: '用法：/audit [页码]，每页 10 条。' },

};

/**
 * Determine language from user object.
 * Returns 'zh' if language code starts with 'zh', otherwise 'en'.
 */
export function getLang(user) {
    if (!user) return 'en';
    if (user.pref_lang === 'zh' || user.pref_lang === 'en') return user.pref_lang;
    if (!user.language_code) return 'en';
    const code = user.language_code.toLowerCase();
    if (code.startsWith('zh')) return 'zh';
    return 'en';
}

/**
 * Get translated text by key.
 */
export function t(key, lang = 'en', params = {}) {
    if (!dict[key]) return key;

    // Fallback to English if lang is not exactly 'zh'
    let text = dict[key][lang === 'zh' ? 'zh' : 'en'] || dict[key]['en'];

    // Replace parameters like {A} -> value
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`{${k}}`, 'g'), v);
    }

    return text;
}
