/**
 *  Database operations (using D1 storage)
 *  数据库操作（使用 D1 存储）
 */
import { config } from '../config.js';

export let d1 = null;
let auditTableEnsurePromise = null;

export function initDb(env) {
    if (env.DB) {
        d1 = env.DB;
    } else if (env.db) {
        d1 = env.db;
    }
}

export class Database {
    async ensureAuditTable() {
        if (auditTableEnsurePromise) {
            await auditTableEnsurePromise;
            return;
        }
        auditTableEnsurePromise = (async () => {
            const stmt = d1.prepare(`
                CREATE TABLE IF NOT EXISTS admin_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target_id TEXT,
                    chat_id TEXT,
                    thread_id TEXT,
                    success INTEGER NOT NULL DEFAULT 1,
                    detail TEXT,
                    created_at INTEGER NOT NULL
                )
            `);
            await stmt.run();
        })();
        await auditTableEnsurePromise;
    }

    // User related operations
    async getUser(user_id) {
        try {
            const stmt = d1.prepare("SELECT * FROM users WHERE user_id = ?");
            const user = await stmt.bind(user_id.toString()).first();
            return user;
        } catch (error) {
            console.error(`Error getting user ${user_id}:`, error);
            return null;
        }
    }

    async setUser(user_id, userData) {
        try {
            const now = Date.now();
            const stmt = d1.prepare(`
                INSERT INTO users (user_id, first_name, last_name, username, message_thread_id, created_at, updated_at, language_code, pref_lang)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    first_name = excluded.first_name,
                    last_name = excluded.last_name,
                    username = excluded.username,
                    message_thread_id = excluded.message_thread_id,
                    updated_at = excluded.updated_at,
                    language_code = excluded.language_code,
                    pref_lang = excluded.pref_lang
            `);
            await stmt.bind(
                user_id.toString(),
                userData.first_name || null,
                userData.last_name || null,
                userData.username ? userData.username.toLowerCase() : null,
                userData.message_thread_id || null,
                userData.created_at || now,
                now,
                userData.language_code || null,
                userData.pref_lang || null
            ).run();
        } catch (error) {
            console.error(`Error setting user ${user_id}:`, error);
            throw error;
        }
    }

    async setUsernameIndex(username, user_id) {
        // Obsolete in D1, handled by index idx_users_username and setUser.
    }

    async getUserIDByUsername(username) {
        try {
            const stmt = d1.prepare("SELECT user_id FROM users WHERE username = ?");
            const result = await stmt.bind(username.toLowerCase()).first();
            return result ? result.user_id : null;
        } catch (error) {
            console.error(`Error resolving username ${username}:`, error);
            return null;
        }
    }

    async getAllUsers(limit = 1000) {
        try {
            const stmt = d1.prepare("SELECT * FROM users LIMIT ?");
            const result = await stmt.bind(limit).all();
            return result.results || [];
        } catch (error) {
            console.error('Error getting all users:', error);
            return [];
        }
    }

    // Message mapping related
    async getMessageMap(key) {
        try {
            const stmt = d1.prepare("SELECT target_id FROM message_mappings WHERE mapping_key = ?");
            const result = await stmt.bind(key).first();
            return result ? result.target_id : null;
        } catch (error) {
            console.error(`Error getting message map ${key}:`, error);
            return null;
        }
    }

    async setMessageMap(key, value) {
        try {
            const stmt = d1.prepare(`
                INSERT INTO message_mappings (mapping_key, target_id) 
                VALUES (?, ?) 
                ON CONFLICT(mapping_key) DO UPDATE SET target_id = excluded.target_id
            `);
            await stmt.bind(key, value).run();
        } catch (error) {
            console.error(`Error setting message map ${key}:`, error);
            throw error;
        }
    }

    // Topic status related
    async getTopicStatus(thread_id) {
        try {
            const stmt = d1.prepare("SELECT * FROM topics WHERE thread_id = ?");
            const result = await stmt.bind(thread_id).first();
            return result || { status: 'opened', created_at: Date.now() };
        } catch (error) {
            console.error(`Error getting topic status ${thread_id}:`, error);
            return { status: 'opened', created_at: Date.now() };
        }
    }

    async setTopicStatus(thread_id, status, metadata = {}) {
        try {
            const stmt = d1.prepare(`
                INSERT INTO topics (thread_id, status, created_at, updated_at, created_by_user, reason, closed_at, inactive_hours)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    created_by_user = COALESCE(excluded.created_by_user, topics.created_by_user),
                    reason = COALESCE(excluded.reason, topics.reason),
                    closed_at = COALESCE(excluded.closed_at, topics.closed_at),
                    inactive_hours = COALESCE(excluded.inactive_hours, topics.inactive_hours)
            `);
            await stmt.bind(
                thread_id,
                status,
                Date.now(),
                Date.now(),
                metadata.created_by_user || null,
                metadata.reason || null,
                metadata.closed_at || null,
                metadata.inactive_hours || null
            ).run();
        } catch (error) {
            console.error(`Error setting topic status ${thread_id}:`, error);
            throw error;
        }
    }

    async findUserByThreadId(thread_id) {
        try {
            // First try to look up via topic created_by_user
            let stmt = d1.prepare("SELECT created_by_user FROM topics WHERE thread_id = ?");
            let topic = await stmt.bind(thread_id).first();
            if (topic && topic.created_by_user) {
                return await this.getUser(topic.created_by_user);
            }

            // Fallback scan via users table
            stmt = d1.prepare("SELECT * FROM users WHERE message_thread_id = ?");
            return await stmt.bind(thread_id).first();
        } catch (e) {
            console.error(`Error looking up user for thread_id ${thread_id}:`, e);
            return null;
        }
    }

    // User state related (Verify state, delivery notice timeouts etc)
    async getUserState(user_id, key) {
        try {
            const stmt = d1.prepare("SELECT state_value FROM user_states WHERE user_id = ? AND state_key = ?");
            const result = await stmt.bind(user_id.toString(), key).first();
            return result ? JSON.parse(result.state_value) : null;
        } catch (error) {
            console.error(`Error getting user state ${user_id}:${key}:`, error);
            return null;
        }
    }

    async setUserState(user_id, key, value) {
        try {
            const stmt = d1.prepare(`
                INSERT INTO user_states (user_id, state_key, state_value)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, state_key) DO UPDATE SET state_value = excluded.state_value
            `);
            await stmt.bind(user_id.toString(), key, JSON.stringify(value)).run();
        } catch (error) {
            console.error(`Error setting user state ${user_id}:${key}:`, error);
            throw error;
        }
    }

    async deleteUserState(user_id, key) {
        try {
            const stmt = d1.prepare("DELETE FROM user_states WHERE user_id = ? AND state_key = ?");
            await stmt.bind(user_id.toString(), key).run();
        } catch (error) {
            console.error(`Error deleting user state ${user_id}:${key}:`, error);
        }
    }

    // Anti-Flood Rate Limiting
    async incrementFloodCount(user_id, windowSeconds) {
        try {
            const now = Date.now() / 1000;
            const state = await this.getUserState(user_id, 'flood_counter') || { count: 0, first_msg_time: now };

            // If the window expired, reset
            if (now - state.first_msg_time > windowSeconds) {
                state.count = 1;
                state.first_msg_time = now;
            } else {
                state.count += 1;
            }

            await this.setUserState(user_id, 'flood_counter', state);
            return state.count;
        } catch (e) {
            console.error('Anti-flood check error:', e);
            return 1; // permit if error
        }
    }

    // Blocked users related
    async isUserBlocked(user_id) {
        try {
            const stmt = d1.prepare("SELECT is_blocked FROM blocks WHERE user_id = ?");
            const result = await stmt.bind(user_id.toString()).first();
            return result ? Boolean(result.is_blocked) : false;
        } catch (error) {
            console.error(`Error checking if user blocked ${user_id}:`, error);
            return false;
        }
    }

    async blockUser(user_id, blocked = true) {
        try {
            const stmt = d1.prepare(`
                INSERT INTO blocks (user_id, is_blocked)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET is_blocked = excluded.is_blocked
            `);
            await stmt.bind(user_id.toString(), blocked ? 1 : 0).run();
        } catch (error) {
            console.error(`Error blocking user ${user_id}:`, error);
            throw error;
        }
    }

    // Verification related
    async isUserVerified(user_id) {
        try {
            const stmt = d1.prepare("SELECT expires_at FROM verifications WHERE user_id = ?");
            const result = await stmt.bind(user_id.toString()).first();

            if (!result) return false;

            if (Date.now() > result.expires_at) {
                const delStmt = d1.prepare("DELETE FROM verifications WHERE user_id = ?");
                await delStmt.bind(user_id.toString()).run();
                return false;
            }
            return true;
        } catch (error) {
            console.error(`Error checking if user verified ${user_id}:`, error);
            return false;
        }
    }

    async verifyUser(user_id, durationMs) {
        try {
            const expiresAt = Date.now() + durationMs;
            const stmt = d1.prepare(`
                INSERT INTO verifications (user_id, expires_at)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at
            `);
            await stmt.bind(user_id.toString(), expiresAt).run();
        } catch (error) {
            console.error(`Error verifying user ${user_id}:`, error);
            throw error;
        }
    }

    // Whitelist related
    async getRemoteWhitelist() {
        if (!config.WHITELIST_URL) return [];

        try {
            const cachedStmt = d1.prepare("SELECT value FROM system_cache WHERE key = 'remote_whitelist'");
            const cached = await cachedStmt.first();
            if (cached) {
                const parsed = JSON.parse(cached.value);
                if (Date.now() - parsed.timestamp < 86400000) {
                    return parsed.userIds;
                }
            }
        } catch (e) { }

        try {
            const response = await fetch(config.WHITELIST_URL);
            if (response.ok) {
                const text = await response.text();
                const userIds = text
                    .split('\n')
                    .map(line => line.split('#')[0].trim())
                    .filter(line => line.length > 0);

                if (userIds.length > 0) {
                    try {
                        const setStmt = d1.prepare(`
                            INSERT INTO system_cache (key, value)
                            VALUES ('remote_whitelist', ?)
                            ON CONFLICT(key) DO UPDATE SET value = excluded.value
                        `);
                        await setStmt.bind(JSON.stringify({ userIds, timestamp: Date.now() })).run();
                    } catch (e) { }
                    return userIds;
                }
            }
        } catch (e) {
            // fallback
            try {
                const cachedStmt = d1.prepare("SELECT value FROM system_cache WHERE key = 'remote_whitelist'");
                const fallback = await cachedStmt.first();
                if (fallback) return JSON.parse(fallback.value).userIds;
            } catch (e) { }
        }
        return [];
    }

    async isUserWhitelisted(user_id) {
        try {
            const stmt = d1.prepare("SELECT 1 FROM whitelists WHERE user_id = ?");
            if (await stmt.bind(user_id.toString()).first()) return true;

            if (config.WHITELIST_URL) {
                const remoteList = await this.getRemoteWhitelist();
                if (remoteList.includes(user_id.toString())) return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    async addToWhitelist(user_id) {
        try {
            const stmt = d1.prepare("INSERT OR IGNORE INTO whitelists (user_id, created_at) VALUES (?, ?)");
            await stmt.bind(user_id.toString(), Date.now()).run();
        } catch (error) {
            console.error(`Error adding user to whitelist ${user_id}:`, error);
            throw error;
        }
    }

    async removeFromWhitelist(user_id) {
        try {
            const stmt = d1.prepare("DELETE FROM whitelists WHERE user_id = ?");
            await stmt.bind(user_id.toString()).run();
        } catch (error) {
            console.error(`Error removing user from whitelist ${user_id}:`, error);
        }
    }

    async getWhitelistedUsers() {
        try {
            const stmt = d1.prepare("SELECT user_id FROM whitelists");
            const result = await stmt.all();
            return result.results.map(row => row.user_id);
        } catch (error) {
            console.error('Error getting whitelist:', error);
            return [];
        }
    }

    // Message frequency limiting - map to user's last_msg_time instead of separate KV
    async getLastMessageTime(user_id) {
        try {
            const stmt = d1.prepare("SELECT last_msg_time FROM users WHERE user_id = ?");
            const result = await stmt.bind(user_id.toString()).first();
            return result ? result.last_msg_time : 0;
        } catch (error) {
            return 0;
        }
    }

    async setLastMessageTime(user_id, timestamp) {
        try {
            const stmt = d1.prepare(`
                INSERT INTO users (user_id, last_msg_time) VALUES (?, ?) 
                ON CONFLICT(user_id) DO UPDATE SET last_msg_time = excluded.last_msg_time
            `);
            await stmt.bind(user_id.toString(), timestamp).run();
        } catch (error) { }
    }

    // Analytics and metrics
    async incrementCounter(key) {
        try {
            const stmt = d1.prepare(`
                INSERT INTO counters (key, value) VALUES (?, 1)
                ON CONFLICT(key) DO UPDATE SET value = value + 1
                RETURNING value
            `);
            const result = await stmt.bind(key).first();
            return result.value;
        } catch (error) {
            console.error(`Error incrementing counter ${key}:`, error);
            return 1;
        }
    }

    async getCounter(key) {
        try {
            const stmt = d1.prepare("SELECT value FROM counters WHERE key = ?");
            const result = await stmt.bind(key).first();
            return result ? result.value : 0;
        } catch (error) {
            return 0;
        }
    }

    async addAdminAuditLog({
        admin_id,
        action,
        target_id = null,
        chat_id = null,
        thread_id = null,
        success = true,
        detail = null
    }) {
        try {
            await this.ensureAuditTable();
            const stmt = d1.prepare(`
                INSERT INTO admin_audit_logs (
                    admin_id, action, target_id, chat_id, thread_id, success, detail, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            await stmt.bind(
                admin_id?.toString() || '',
                action,
                target_id ? target_id.toString() : null,
                chat_id ? chat_id.toString() : null,
                thread_id ? thread_id.toString() : null,
                success ? 1 : 0,
                detail,
                Date.now()
            ).run();
        } catch (error) {
            console.error('Error writing admin audit log:', error);
        }
    }

    async getAdminAuditLogs(limit = 10, offset = 0) {
        try {
            await this.ensureAuditTable();
            const stmt = d1.prepare(`
                SELECT id, admin_id, action, target_id, chat_id, thread_id, success, detail, created_at
                FROM admin_audit_logs
                ORDER BY id DESC
                LIMIT ? OFFSET ?
            `);
            const result = await stmt.bind(limit, offset).all();
            return result.results || [];
        } catch (error) {
            console.error('Error reading admin audit logs:', error);
            return [];
        }
    }

    async getAdminAuditLogCount() {
        try {
            await this.ensureAuditTable();
            const stmt = d1.prepare(`SELECT COUNT(1) AS c FROM admin_audit_logs`);
            const row = await stmt.first();
            return Number(row?.c || 0);
        } catch (error) {
            console.error('Error counting admin audit logs:', error);
            return 0;
        }
    }

    // Scheduled tasks
    async setScheduledTask(task_id, data) {
        await this.setUserState('system_tasks', task_id, data);
    }

    async getScheduledTask(task_id) {
        return await this.getUserState('system_tasks', task_id);
    }

    async deleteScheduledTask(task_id) {
        await this.deleteUserState('system_tasks', task_id);
    }

    // Old-mode reply mapping: message_id (in admin chat) -> user_id
    // Stored as JSON {uid, ts} to support time-based cleanup
    async getOldMessageMap(message_id) {
        const val = await this.getUserState('old_msg_map', message_id.toString());
        if (!val) return null;
        try {
            const parsed = JSON.parse(val);
            return parsed.uid ? parsed.uid.toString() : val.toString();
        } catch {
            // Backward compat: old entries stored plain string
            return val.toString();
        }
    }
    async setOldMessageMap(message_id, user_id) {
        await this.setUserState('old_msg_map', message_id.toString(),
            JSON.stringify({ uid: user_id.toString(), ts: Date.now() })
        );
    }

    async isUserBlockedOld(user_id) { return false; }
    async blockUserOld(user_id, blocked = true) { }
}

export const db = new Database();

// Template Utilities
export async function tplSet(key, value) {
    const stmt = d1.prepare(`
        INSERT INTO templates (key_name, content) VALUES (?, ?)
        ON CONFLICT(key_name) DO UPDATE SET content = excluded.content
    `);
    await stmt.bind(key, value).run();
}
export async function tplGet(key) {
    const stmt = d1.prepare("SELECT content FROM templates WHERE key_name = ?");
    const result = await stmt.bind(key).first();
    return result ? result.content : null;
}
export async function tplDel(key) {
    const stmt = d1.prepare("DELETE FROM templates WHERE key_name = ?");
    await stmt.bind(key).run();
}
export async function tplList() {
    const stmt = d1.prepare("SELECT key_name FROM templates");
    const result = await stmt.all();
    return result.results.map(row => row.key_name);
}

export async function appendUserLog(user_id, direction, message, formatDateKeyUTC) {
    try {
        const day = formatDateKeyUTC();

        let type = message.text ? 'text' : 'other';
        let text = message.text || null;
        let caption = message.caption || null;
        let file_id = null;
        let file_unique_id = null;
        let file_name = null;
        let mime_type = null;
        let file_size = null;
        let width = null;
        let height = null;
        let duration = null;
        let performer = null;
        let title = null;
        let emoji = null;
        let set_name = null;
        let is_animated = null;
        let is_video = null;
        let length = null;

        if (message.photo) {
            type = 'photo';
            const pic = message.photo[message.photo.length - 1];
            file_id = pic.file_id;
            file_unique_id = pic.file_unique_id;
            width = pic.width;
            height = pic.height;
            file_size = pic.file_size;
            text = caption || 'photo.jpg';
        } else if (message.document) {
            type = 'document';
            file_id = message.document.file_id;
            file_unique_id = message.document.file_unique_id;
            file_name = message.document.file_name;
            mime_type = message.document.mime_type;
            file_size = message.document.file_size;
            if (file_name) text = file_name;
            else {
                const ext = (mime_type || '').split('/')[1] || 'bin';
                text = `document.${ext}`;
            }
        } else if (message.voice) {
            type = 'voice';
            file_id = message.voice.file_id;
            file_unique_id = message.voice.file_unique_id;
            mime_type = message.voice.mime_type;
            duration = message.voice.duration;
            file_size = message.voice.file_size;
            const ext = (mime_type || '').split('/')[1] || 'ogg';
            text = `voice.${ext}`;
        } else if (message.audio) {
            type = 'audio';
            file_id = message.audio.file_id;
            file_unique_id = message.audio.file_unique_id;
            mime_type = message.audio.mime_type;
            duration = message.audio.duration;
            file_size = message.audio.file_size;
            performer = message.audio.performer;
            title = message.audio.title;
            const name = message.audio.file_name || title || 'audio';
            const ext = (mime_type || '').split('/')[1] || 'mp3';
            text = `${name}.${ext}`;
        } else if (message.video) {
            type = 'video';
            file_id = message.video.file_id;
            file_unique_id = message.video.file_unique_id;
            mime_type = message.video.mime_type;
            duration = message.video.duration;
            width = message.video.width;
            height = message.video.height;
            file_size = message.video.file_size;
            const name = message.video.file_name || 'video';
            const ext = (mime_type || '').split('/')[1] || 'mp4';
            text = `${name}.${ext}`;
        } else if (message.video_note) {
            type = 'video_note';
            file_id = message.video_note.file_id;
            file_unique_id = message.video_note.file_unique_id;
            duration = message.video_note.duration;
            length = message.video_note.length;
            file_size = message.video_note.file_size;
            text = 'video_note.mp4';
        } else if (message.animation) {
            type = 'animation';
            file_id = message.animation.file_id;
            file_unique_id = message.animation.file_unique_id;
            file_name = message.animation.file_name;
            mime_type = message.animation.mime_type;
            file_size = message.animation.file_size;
            width = message.animation.width;
            height = message.animation.height;
            duration = message.animation.duration;
            if (file_name) text = file_name;
            else {
                const ext = (mime_type || '').split('/')[1] || 'gif';
                text = `animation.${ext}`;
            }
        } else if (message.sticker) {
            type = 'sticker';
            file_id = message.sticker.file_id;
            file_unique_id = message.sticker.file_unique_id;
            emoji = message.sticker.emoji;
            set_name = message.sticker.set_name;
            width = message.sticker.width;
            height = message.sticker.height;
            is_animated = message.sticker.is_animated ? 1 : 0;
            is_video = message.sticker.is_video ? 1 : 0;
            text = 'sticker.webp';
        }

        const stmt = d1.prepare(`
            INSERT INTO message_logs (
                user_id, date_key, created_at, direction, message_id, type, text, caption,
                file_id, file_unique_id, file_name, mime_type, file_size, width, height,
                duration, performer, title, emoji, set_name, is_animated, is_video, length
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        await stmt.bind(
            user_id.toString(), day, Date.now(), direction, message.message_id || null, type, text, caption,
            file_id, file_unique_id, file_name, mime_type, file_size, width, height,
            duration, performer, title, emoji, set_name, is_animated, is_video, length
        ).run();

        // We could implement cleanup for > 500 entries per day if needed.
        // DELETE FROM message_logs WHERE id NOT IN (SELECT id FROM message_logs WHERE user_id = ? AND date_key = ? ORDER BY id DESC LIMIT 500)
    } catch (e) {
        console.error('appendUserLog error:', e);
    }
}
