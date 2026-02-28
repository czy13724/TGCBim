/**
 * Configuration for tgcontactbot
 * tgcontactbot 的配置
 */
import { normalizeId, parseAdmins } from './utils/utils.js';

export const config = {
    TOKEN: undefined,
    WEBHOOK: '/endpoint',
    SECRET: undefined,
    ADMIN_UID: undefined,
    ADMIN_GROUP_ID: undefined,
    WELCOME_MESSAGE: 'Welcome to use LeviFREE bot!',
    MESSAGE_INTERVAL: 1,
    DELETE_TOPIC_AS_BAN: false,
    MAX_BROADCAST_BATCH: 50,
    AUTO_CLOSE_INACTIVE_HOURS: 72,
    NOTIFY_INTERVAL: 3600 * 1000,
    SECURITY_DB_URL: undefined,
    NOTIFICATION_URL: undefined,
    START_MSG_URL: undefined,
    ENABLE_NOTIFICATION: false,
    ENABLE_VERIFICATION: true, // Enable two-step verification for strangers
    VERIFICATION_VALID_HOURS: 2, // How long verification lasts for strangers
    WHITELIST_URL: undefined, // Remote URL for whitelisted user IDs
    ENABLE_AUTO_TRANSLATE: false,
    TRANSLATE_TARGET_LANG: 'en',
    EXPORT_SECRET: undefined,
    BASE_PATH: '',
    ADMINS: '',
    MAINTENANCE_MESSAGE: 'We are under maintenance. Please try again later.',
    PUBLIC_BASE_URL: undefined,
    ENABLE_SPAM_FILTER: true,
    SPAM_KEYWORDS: '操逼赚钱,挖掘花,招聘花,提供设备,代理花,兼职,招探花',
    SPAM_ACTION: 'block',
    DELETE_SPAM_MESSAGE: true,
    SPAM_BLOCKLIST_URL: 'https://raw.githubusercontent.com/czy13724/czy13724/levi/blocklist.txt',
    GROUP_SPAM_DETECTION: true,
    GROUP_SPAM_ACTION: 'ban',
    GROUP_ADMIN_PERMISSIONS: true,
    ENV_LOG_RETENTION_DAYS: 0,

    // Advanced Features
    ANTI_FLOOD_MESSAGES: 5, // 5 messages
    ANTI_FLOOD_SECONDS: 5,  // per 5 seconds

    // Runtime
    // 运行时
    BASE_ORIGIN: '',
};

export function initConfig(env) {
    if (!env) return;

    if (typeof env.BOT_TOKEN !== 'undefined') config.TOKEN = env.BOT_TOKEN
    else if (typeof env.ENV_BOT_TOKEN !== 'undefined') config.TOKEN = env.ENV_BOT_TOKEN

    if (typeof env.BOT_SECRET !== 'undefined') config.SECRET = env.BOT_SECRET
    else if (typeof env.ENV_BOT_SECRET !== 'undefined') config.SECRET = env.ENV_BOT_SECRET

    if (typeof env.ADMIN_UID !== 'undefined') config.ADMIN_UID = env.ADMIN_UID
    else if (typeof env.ENV_ADMIN_UID !== 'undefined') config.ADMIN_UID = env.ENV_ADMIN_UID

    if (typeof env.ADMIN_GROUP_ID !== 'undefined') config.ADMIN_GROUP_ID = env.ADMIN_GROUP_ID
    else if (typeof env.ENV_ADMIN_GROUP_ID !== 'undefined') config.ADMIN_GROUP_ID = env.ENV_ADMIN_GROUP_ID

    if (typeof env.WEBHOOK_PATH !== 'undefined') config.WEBHOOK = env.WEBHOOK_PATH

    if (typeof env.WELCOME_MESSAGE !== 'undefined') config.WELCOME_MESSAGE = env.WELCOME_MESSAGE
    if (typeof env.MESSAGE_INTERVAL !== 'undefined') config.MESSAGE_INTERVAL = parseInt(env.MESSAGE_INTERVAL) || config.MESSAGE_INTERVAL
    if (typeof env.DELETE_TOPIC_AS_BAN !== 'undefined') config.DELETE_TOPIC_AS_BAN = env.DELETE_TOPIC_AS_BAN === 'true'
    if (typeof env.MAX_BROADCAST_BATCH !== 'undefined') config.MAX_BROADCAST_BATCH = parseInt(env.MAX_BROADCAST_BATCH) || config.MAX_BROADCAST_BATCH
    if (typeof env.AUTO_CLOSE_INACTIVE_HOURS !== 'undefined') config.AUTO_CLOSE_INACTIVE_HOURS = parseInt(env.AUTO_CLOSE_INACTIVE_HOURS) || config.AUTO_CLOSE_INACTIVE_HOURS

    if (typeof env.SECURITY_DB_URL !== 'undefined') config.SECURITY_DB_URL = env.SECURITY_DB_URL
    if (typeof env.NOTIFICATION_URL !== 'undefined') config.NOTIFICATION_URL = env.NOTIFICATION_URL
    if (typeof env.START_MSG_URL !== 'undefined') config.START_MSG_URL = env.START_MSG_URL
    if (typeof env.ENABLE_NOTIFICATION !== 'undefined') config.ENABLE_NOTIFICATION = env.ENABLE_NOTIFICATION !== 'false'
    if (typeof env.ENABLE_VERIFICATION !== 'undefined') config.ENABLE_VERIFICATION = env.ENABLE_VERIFICATION !== 'false'
    if (typeof env.VERIFICATION_VALID_HOURS !== 'undefined') config.VERIFICATION_VALID_HOURS = parseInt(env.VERIFICATION_VALID_HOURS) || config.VERIFICATION_VALID_HOURS
    if (typeof env.WHITELIST_URL !== 'undefined') config.WHITELIST_URL = env.WHITELIST_URL
    if (typeof env.ENABLE_AUTO_TRANSLATE !== 'undefined') config.ENABLE_AUTO_TRANSLATE = env.ENABLE_AUTO_TRANSLATE === 'true'
    if (typeof env.TRANSLATE_TARGET_LANG !== 'undefined') config.TRANSLATE_TARGET_LANG = env.TRANSLATE_TARGET_LANG
    if (typeof env.EXPORT_SECRET !== 'undefined') config.EXPORT_SECRET = env.EXPORT_SECRET
    if (typeof env.BASE_PATH !== 'undefined') config.BASE_PATH = env.BASE_PATH
    if (typeof env.ADMINS !== 'undefined') config.ADMINS = env.ADMINS
    if (typeof env.MAINTENANCE_MESSAGE !== 'undefined') config.MAINTENANCE_MESSAGE = env.MAINTENANCE_MESSAGE
    if (typeof env.PUBLIC_BASE_URL !== 'undefined') config.PUBLIC_BASE_URL = env.PUBLIC_BASE_URL

    if (typeof env.ENABLE_SPAM_FILTER !== 'undefined') config.ENABLE_SPAM_FILTER = env.ENABLE_SPAM_FILTER !== 'false'
    if (typeof env.SPAM_KEYWORDS !== 'undefined') config.SPAM_KEYWORDS = env.SPAM_KEYWORDS
    if (typeof env.SPAM_ACTION !== 'undefined') config.SPAM_ACTION = env.SPAM_ACTION
    if (typeof env.DELETE_SPAM_MESSAGE !== 'undefined') config.DELETE_SPAM_MESSAGE = env.DELETE_SPAM_MESSAGE !== 'false'
    if (typeof env.SPAM_BLOCKLIST_URL !== 'undefined') config.SPAM_BLOCKLIST_URL = env.SPAM_BLOCKLIST_URL

    if (typeof env.GROUP_SPAM_DETECTION !== 'undefined') config.GROUP_SPAM_DETECTION = env.GROUP_SPAM_DETECTION !== 'false'
    if (typeof env.GROUP_SPAM_ACTION !== 'undefined') config.GROUP_SPAM_ACTION = env.GROUP_SPAM_ACTION
    if (typeof env.GROUP_ADMIN_PERMISSIONS !== 'undefined') config.GROUP_ADMIN_PERMISSIONS = env.GROUP_ADMIN_PERMISSIONS !== 'false'

    if (typeof env.ENV_LOG_RETENTION_DAYS !== 'undefined') config.ENV_LOG_RETENTION_DAYS = parseInt(env.ENV_LOG_RETENTION_DAYS) || 0

    if (typeof env.ANTI_FLOOD_MESSAGES !== 'undefined') config.ANTI_FLOOD_MESSAGES = parseInt(env.ANTI_FLOOD_MESSAGES) || config.ANTI_FLOOD_MESSAGES
    if (typeof env.ANTI_FLOOD_SECONDS !== 'undefined') config.ANTI_FLOOD_SECONDS = parseInt(env.ANTI_FLOOD_SECONDS) || config.ANTI_FLOOD_SECONDS
    if (typeof env.BUSINESS_HOURS_START !== 'undefined') config.BUSINESS_HOURS_START = env.BUSINESS_HOURS_START
    if (typeof env.BUSINESS_HOURS_END !== 'undefined') config.BUSINESS_HOURS_END = env.BUSINESS_HOURS_END
    if (typeof env.BUSINESS_TIMEZONE !== 'undefined') config.BUSINESS_TIMEZONE = env.BUSINESS_TIMEZONE
}

export function isOwner(id) {
    return normalizeId(id) === normalizeId(config.ADMIN_UID)
}

export function isAdminUser(id) {
    if (isOwner(id)) return true
    const set = parseAdmins(config.ADMINS)
    return set.has(normalizeId(id))
}

export function isGlobalAdminOrOwner(id) {
    return isOwner(id) || isAdminUser(id)
}
