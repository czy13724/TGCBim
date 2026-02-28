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
        en: "❌ Incorrect answer. Please try again.",
        zh: "❌ 答案错误，请重试。"
    },
    verify_title: {
        en: "🤖 <b>Anti-spam Verification</b>\n\nTo continue, please solve:\n\n<b>{A} + {B} = ?</b>\n\n<i>Select the correct answer, then click Confirm.</i>",
        zh: "🤖 <b>防垃圾消息验证</b>\n\n为了继续操作，请计算：\n\n<b>{A} + {B} = ?</b>\n\n<i>请选择正确答案，然后点击确认。</i>"
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

    // KV Storage Limits
    kv_limit_msg: {
        en: "Sorry, due to system storage limits, your message cannot be delivered at the moment.\n\nThe recipient has been notified. Please try again tomorrow or wait for the issue to be resolved.\n\nFor urgent matters, please contact directly.",
        zh: "抱歉，由于系统存储限制，您的消息暂时无法送达。\n\n已通知接收方。请明天重试或等待问题解决。\n\n如有急事，请直接联系。"
    }
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
