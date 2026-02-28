/**
 * Verification flow logic
 * 验证流程逻辑
 */
import { config } from '../config.js';
import { db } from '../services/db.js';
import { sendMessage, editMessage, editMessageReplyMarkup, answerCallbackQuery } from '../services/telegram.js';
import { getLang, t } from '../services/i18n.js';

/**
 * Handles incoming text/media messages for users who are not yet verified.
 * Returns true if the message was handled by the verification flow.
 */
export async function handleVerification(message, user) {
    if (!config.ENABLE_VERIFICATION) return false;

    const user_id = user.id;

    if (await db.isUserVerified(user_id)) return false;
    if (await db.isUserWhitelisted(user_id)) return false;

    // Any new message from an unverified user triggers a new captcha or shows the existing one if we track message_ids
    // To keep it simple: just send a new captcha and tell them to solve it.
    const stateKey = 'verification_state';
    const existingState = await db.getUserState(user_id, stateKey);
    const dbUser = await db.getUser(user_id);
    const lang = getLang(dbUser || user);

    // If they send text instead of clicking, politely refuse
    await sendMessage({
        chat_id: message.chat.id,
        text: t('verify_pending', lang)
    });

    // Always dispatch a fresh captcha to prevent them losing the buttons
    await sendCaptcha(message.chat.id, user_id, lang, null, message);
    return true;
}

/**
 * Handles inline button clicks (Callback Queries) for verification
 */
export async function handleVerificationCallback(callbackQuery) {
    const data = callbackQuery.data;
    if (!data.startsWith('verify:')) return false;

    const user_id = callbackQuery.from.id;
    const message = callbackQuery.message;
    const stateKey = 'verification_state';

    const state = await db.getUserState(user_id, stateKey);
    let dbUser = await db.getUser(user_id);
    const lang = getLang(dbUser || callbackQuery.from);

    if (!state) {
        // Expired or invalid
        await answerCallbackQuery(callbackQuery.id, { text: t('verify_expired', lang), show_alert: true });
        await sendCaptcha(message.chat.id, user_id, lang, message.message_id);
        return true;
    }

    const action = data.split(':')[1];

    if (action.startsWith('lang_')) {
        const switchLang = action.split('_')[1]; // 'en' or 'zh'
        if (dbUser) {
            dbUser.pref_lang = switchLang;
            await db.setUser(user_id, dbUser);
        } else {
            dbUser = { user_id: user_id, pref_lang: switchLang, created_at: Date.now() };
            await db.setUser(user_id, dbUser);
        }
        await answerCallbackQuery(callbackQuery.id);
        await sendCaptcha(message.chat.id, user_id, switchLang, message.message_id);
        return true;
    }

    if (action === 'confirm') {
        // Step 2: Confirmation
        if (state.selected === null) {
            await answerCallbackQuery(callbackQuery.id, { text: t('verify_select_first', lang), show_alert: true });
            return true;
        }

        if (state.selected === state.expected) {
            // Success!
            const durationMs = (config.VERIFICATION_VALID_HOURS || 2) * 60 * 60 * 1000;
            await db.verifyUser(user_id, durationMs);
            await db.deleteUserState(user_id, stateKey);

            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: t('verify_success_msg', lang)
            });
            await answerCallbackQuery(callbackQuery.id, { text: t('verify_success_alert', lang) });

            return { success: true, pending_message: state.pending_message };
        } else {
            // Failed!
            await db.deleteUserState(user_id, stateKey);
            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: t('verify_failed_msg', lang)
            });
            await answerCallbackQuery(callbackQuery.id, { text: t('verify_failed_alert', lang), show_alert: true });
            await sendCaptcha(message.chat.id, user_id, lang, message.message_id, state.pending_message);
        }
    } else {
        // Step 1: Selection
        const selectedValue = parseInt(action, 10);
        state.selected = selectedValue;
        await db.setUserState(user_id, stateKey, state);

        // Update the keyboard to show the selection & confirm button
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

async function sendCaptcha(chat_id, user_id, lang, existing_message_id = null, pending_message = null) {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    const answer = a + b;

    // Generate 3 options
    let options = new Set([answer]);
    while (options.size < 3) {
        let fake = answer + (Math.floor(Math.random() * 5) + 1) * (Math.random() < 0.5 ? 1 : -1);
        if (fake > 0) options.add(fake);
    }
    options = Array.from(options).sort(() => Math.random() - 0.5);

    const stateKey = 'verification_state';

    // Check if we already have a pending message in state to persist it
    let saved_pending_message = pending_message;
    if (!saved_pending_message) {
        const existingState = await db.getUserState(user_id, stateKey);
        if (existingState && existingState.pending_message) {
            saved_pending_message = existingState.pending_message;
        }
    }

    await db.setUserState(user_id, stateKey, {
        expected: answer,
        selected: null,
        options: options,
        pending_message: saved_pending_message
    });

    const questionText = t('verify_title', lang, { A: a, B: b });

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
