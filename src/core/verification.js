/**
 * Verification flow logic
 * 验证流程逻辑
 */
import { config } from '../config.js';
import { db } from '../services/db.js';
import { sendMessage, editMessage, editMessageReplyMarkup, answerCallbackQuery } from '../services/telegram.js';
import { getLang, t } from '../services/i18n.js';

const VERIFY_STATE_KEY = 'verification_state';
const VERIFY_BAN_KEY = 'verify_ban';
const MAX_FAIL_COUNT = 3;
const BAN_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Format remaining ban time into human-readable string
 * 将剩余封禁时间格式化为可读字符串
 */
function formatBanTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const mins = Math.ceil((ms % 3600000) / 60000);
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h`;
    return `${mins}m`;
}

/**
 * Generate a random math question (addition, subtraction or multiplication)
 * 随机生成一道数学题（加法、减法或乘法）
 */
function generateQuestion() {
    const ops = ['+', '-', '×'];
    const op = ops[Math.floor(Math.random() * ops.length)];

    let a, b, answer;
    if (op === '+') {
        a = Math.floor(Math.random() * 10) + 1;  // 1-10
        b = Math.floor(Math.random() * 10) + 1;  // 1-10
        answer = a + b;
    } else if (op === '-') {
        a = Math.floor(Math.random() * 10) + 5;  // 5-14
        b = Math.floor(Math.random() * (a - 1)) + 1; // 1 to a-1 (always positive result)
        answer = a - b;
    } else { // '×'
        a = Math.floor(Math.random() * 7) + 2;  // 2-8
        b = Math.floor(Math.random() * 7) + 2;  // 2-8
        answer = a * b;
    }

    // Generate 3 unique options close to the answer
    // 生成3个接近正确答案的唯一选项
    let options = new Set([answer]);
    let attempts = 0;
    while (options.size < 3 && attempts < 50) {
        attempts++;
        const offset = Math.floor(Math.random() * 5) + 1;
        const candidate = answer + (Math.random() < 0.5 ? offset : -offset);
        if (candidate > 0) options.add(candidate);
    }
    options = Array.from(options).sort(() => Math.random() - 0.5);

    return { a, b, op, answer, options };
}

/**
 * Handles incoming text/media messages for users who are not yet verified.
 * Returns true if the message was handled by the verification flow.
 * 处理未验证用户的传入消息，若被验证流程拦截则返回 true
 */
export async function handleVerification(message, user) {
    if (!config.ENABLE_VERIFICATION) return false;

    const user_id = user.id;

    if (await db.isUserVerified(user_id)) return false;
    if (await db.isUserWhitelisted(user_id)) return false;

    let dbUser = await db.getUser(user_id);
    const lang = getLang(dbUser || user);

    // Check temp ban
    // 检查临时封禁
    const banState = await db.getUserState(user_id, VERIFY_BAN_KEY);
    if (banState && banState.until > Date.now()) {
        const timeStr = formatBanTime(banState.until - Date.now());
        await sendMessage({
            chat_id: message.chat.id,
            text: t('verify_banned', lang, { TIME: timeStr })
        });
        return true;
    }

    // Clear expired ban
    // 清除过期封禁
    if (banState) {
        await db.deleteUserState(user_id, VERIFY_BAN_KEY).catch(() => { });
    }

    // Check existing captcha state — don't spam new captchas
    // 检查现有验证状态，避免重复发送
    const existingState = await db.getUserState(user_id, VERIFY_STATE_KEY);

    await sendMessage({
        chat_id: message.chat.id,
        text: t('verify_pending', lang)
    });

    // Send fresh captcha (or update existing one if we have its message)
    // 发送新验证题（或更新现有的）
    await sendCaptcha(message.chat.id, user_id, lang, null, message, existingState?.fail_count || 0);
    return true;
}

/**
 * Handles inline button clicks (Callback Queries) for verification
 * 处理验证内联按钮点击
 */
export async function handleVerificationCallback(callbackQuery) {
    const data = callbackQuery.data;
    if (!data.startsWith('verify:')) return false;

    const user_id = callbackQuery.from.id;
    const message = callbackQuery.message;

    let dbUser = await db.getUser(user_id);
    const lang = getLang(dbUser || callbackQuery.from);

    // Check temp ban
    // 检查临时封禁
    const banState = await db.getUserState(user_id, VERIFY_BAN_KEY);
    if (banState && banState.until > Date.now()) {
        const timeStr = formatBanTime(banState.until - Date.now());
        await answerCallbackQuery(callbackQuery.id, {
            text: t('verify_banned', lang, { TIME: timeStr }),
            show_alert: true
        });
        return true;
    }

    const state = await db.getUserState(user_id, VERIFY_STATE_KEY);

    if (!state) {
        // Expired or invalid
        // 已过期或无效
        await answerCallbackQuery(callbackQuery.id, { text: t('verify_expired', lang), show_alert: true });
        await sendCaptcha(message.chat.id, user_id, lang, message.message_id);
        return true;
    }

    const action = data.split(':')[1];

    // Language switch
    // 语言切换
    if (action.startsWith('lang_')) {
        const switchLang = action.split('_')[1];
        if (dbUser) {
            dbUser.pref_lang = switchLang;
            dbUser.language_code = dbUser.language_code || callbackQuery.from.language_code || null;
            await db.setUser(user_id, dbUser);
        } else {
            dbUser = {
                user_id: user_id,
                pref_lang: switchLang,
                language_code: callbackQuery.from.language_code || null,
                first_name: callbackQuery.from.first_name || 'User',
                last_name: callbackQuery.from.last_name || null,
                username: callbackQuery.from.username || null,
                created_at: Date.now()
            };
            await db.setUser(user_id, dbUser);
        }
        await db.setUserState(user_id, 'user_pref_lang', switchLang).catch(() => { })
        await answerCallbackQuery(callbackQuery.id);
        await sendCaptcha(message.chat.id, user_id, switchLang, message.message_id, null, state.fail_count || 0);
        return true;
    }

    if (action === 'confirm') {
        // Step 2: Confirmation
        // 步骤2：确认答案
        if (state.selected === null) {
            await answerCallbackQuery(callbackQuery.id, { text: t('verify_select_first', lang), show_alert: true });
            return true;
        }

        if (state.selected === state.expected) {
            // ✅ Success!
            const durationMs = (config.VERIFICATION_VALID_HOURS || 2) * 60 * 60 * 1000;
            await db.verifyUser(user_id, durationMs);
            await db.deleteUserState(user_id, VERIFY_STATE_KEY);
            await db.setUserState(user_id, 'user_pref_lang', lang).catch(() => { })

            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: t('verify_success_msg', lang)
            });
            await answerCallbackQuery(callbackQuery.id, { text: t('verify_success_alert', lang) });

            return { success: true, pending_message: state.pending_message };

        } else {
            // ❌ Wrong answer
            // ❌ 答案错误
            const failCount = (state.fail_count || 0) + 1;
            await db.deleteUserState(user_id, VERIFY_STATE_KEY);

            if (failCount >= MAX_FAIL_COUNT) {
                // Temp ban for 6 hours
                // 临时封禁6小时
                const banUntil = Date.now() + BAN_DURATION_MS;
                await db.setUserState(user_id, VERIFY_BAN_KEY, { until: banUntil });

                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: t('verify_banned', lang, { TIME: '6h' })
                });
                await answerCallbackQuery(callbackQuery.id, { text: t('verify_failed_alert', lang), show_alert: true });

            } else {
                // Show remaining attempts and new captcha
                // 显示剩余次数并发送新验证题
                const left = MAX_FAIL_COUNT - failCount;
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: t('verify_failed_msg', lang, { LEFT: left })
                });
                await answerCallbackQuery(callbackQuery.id, { text: t('verify_failed_alert', lang), show_alert: true });
                // Small pause before sending new captcha
                await new Promise(r => setTimeout(r, 800));
                await sendCaptcha(message.chat.id, user_id, lang, null, state.pending_message, failCount);
            }
        }

    } else {
        // Step 1: Selection
        // 步骤1：选择答案
        const selectedValue = parseInt(action, 10);
        state.selected = selectedValue;
        await db.setUserState(user_id, VERIFY_STATE_KEY, state);

        const newMarkup = buildKeyboard(state.options, selectedValue, lang);
        await editMessageReplyMarkup({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: newMarkup
        });
        await answerCallbackQuery(callbackQuery.id);
    }

    return true;
}

/**
 * Send or update a captcha message
 * 发送或更新验证题消息
 */
async function sendCaptcha(chat_id, user_id, lang, existing_message_id = null, pending_message = null, fail_count = 0) {
    const { a, b, op, answer, options } = generateQuestion();

    // Persist pending message if not provided
    // 如果未提供待发送消息，则从现有状态中恢复
    let saved_pending_message = pending_message;
    if (!saved_pending_message) {
        const existingState = await db.getUserState(user_id, VERIFY_STATE_KEY);
        if (existingState?.pending_message) {
            saved_pending_message = existingState.pending_message;
        }
    }

    await db.setUserState(user_id, VERIFY_STATE_KEY, {
        expected: answer,
        selected: null,
        options: options,
        op: op,
        pending_message: saved_pending_message,
        fail_count: fail_count
    });

    const questionText = t('verify_title', lang, { A: a, OP: op, B: b });

    if (existing_message_id) {
        await editMessage({
            chat_id: chat_id,
            message_id: existing_message_id,
            text: questionText,
            parse_mode: 'HTML',
            reply_markup: buildKeyboard(options, null, lang)
        });
    } else {
        await sendMessage({
            chat_id: chat_id,
            text: questionText,
            parse_mode: 'HTML',
            reply_markup: buildKeyboard(options, null, lang)
        });
    }
}

function buildKeyboard(options, selectedVal, lang) {
    // Row 1: The number choices
    const row1 = options.map(opt => ({
        text: opt === selectedVal ? `☑️ ${opt}` : `${opt}`,
        callback_data: `verify:${opt}`
    }));

    const keyboard = [row1];

    // Row 2: Confirm button (only if something is selected)
    if (selectedVal !== null) {
        keyboard.push([{
            text: t('verify_confirm_btn', lang),
            callback_data: 'verify:confirm'
        }]);
    }

    // Row 3: Language toggle buttons
    keyboard.push([
        { text: '🇺🇸 English', callback_data: 'verify:lang_en' },
        { text: '🇨🇳 中文', callback_data: 'verify:lang_zh' }
    ]);

    return { inline_keyboard: keyboard };
}
