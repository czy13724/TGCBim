/**
 * Utility functions for tgcontactbot module
 * tgcontactbot 模块的工具函数
 */

export function escapeHtml(text) {
    if (!text) return ''
    return text.toString().replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export function randomString(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let result = ''
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
}

export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    })
}

export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
}

export function mentionHtml(user_id, name) {
    return `<a href="tg://user?id=${user_id}">${escapeHtml(name)}</a>`
}

export function normalizeId(id) {
    return (id ?? '').toString()
}

export function parseAdmins(list) {
    return new Set((list || '').split(',').map(v => v.trim()).filter(Boolean))
}

// === Simple conversation logging for export (legacy-friendly) ===
// === 用于导出的简单对话日志记录（兼容旧版） ===
export function formatDateKeyUTC(date = new Date()) {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, '0')
    const d = String(date.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

export function parseDateUTC(dateStr) {
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateStr || '')
    if (!m) return null
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return isNaN(d.getTime()) ? null : d
}

export function addDaysUTC(date, days) {
    const d = new Date(date.getTime())
    d.setUTCDate(d.getUTCDate() + days)
    return d
}

export function listDateKeysInclusive(startStr, endStr) {
    const start = parseDateUTC(startStr)
    const end = parseDateUTC(endStr)
    if (!start || !end || start.getTime() > end.getTime()) return []
    const keys = []
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d = addDaysUTC(d, 1)) {
        keys.push(formatDateKeyUTC(d))
    }
    return keys
}

export function renderExportHtml(title, logs) {
    const rows = (logs || []).map((item) => {
        const time = item.t ? new Date(item.t).toISOString() : ''
        const dir = item.dir === 'u2a' ? 'User → Admin' : 'Admin → User'
        const type = item.type || 'text'
        let text = item.text ? escapeHtml(item.text) : ''
        if (!text) {
            // Fallbacks: use stored file_name or synthesize from mime/type
            // 兜底：使用存储的文件名或从 mime/type 合成
            if (item.file_name) {
                text = `${escapeHtml(item.file_name)}`
            } else if (type === 'photo') {
                text = 'photo.jpg'
            } else if (type === 'voice') {
                text = 'voice.ogg'
            } else if (type === 'video') {
                text = 'video.mp4'
            } else if (type === 'document') {
                text = 'document.bin'
            } else if (type === 'sticker') {
                text = 'sticker.webp'
            }
        }
        const caption = item.caption ? escapeHtml(item.caption) : ''
        const link = item.file_url ? `<a href="${item.file_url}" target="_blank">download</a>` : (item.file_id ? `<code>${item.file_id}</code>` : '')
        let preview = ''
        if (item.file_url) {
            if (type === 'photo' || type === 'sticker' || type === 'animation') {
                preview = `<div><img src="${item.file_url}" alt="media" style="max-width:240px;max-height:240px;border:1px solid #eee"/></div>`
            } else if (type === 'video' || type === 'video_note') {
                preview = `<div><video src="${item.file_url}" controls style="max-width:320px;max-height:240px;border:1px solid #eee"></video></div>`
            } else if (type === 'audio' || type === 'voice') {
                preview = `<div><audio src="${item.file_url}" controls></audio></div>`
            }
        }
        const extra = item._date ? `<small>${item._date}</small>` : ''
        return `<tr><td>${time}</td><td>${dir}</td><td>${type}</td><td>${text || caption}${preview}</td><td>${link}</td><td>${extra}</td></tr>`
    }).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px}th{background:#f6f6f6;text-align:left}code{background:#f2f2f2;padding:2px 4px;border-radius:3px}</style></head><body><h2>${escapeHtml(title)}</h2><table><thead><tr><th>Time (UTC)</th><th>Direction</th><th>Type</th><th>Text/Caption</th><th>Media</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
    return html
}

export async function hmacHex(secret, data) {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data))
    return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function isBusinessHours(startStr, endStr, timeZone) {
    if (!startStr || !endStr) return true; // if not configured, always online

    try {
        const now = new Date();
        const options = { timeZone: timeZone || 'UTC', hour: '2-digit', minute: '2-digit', hour12: false };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        // returns something like "09:30" or "24:00" -> "00:00"
        let currentTimeStr = formatter.format(now);

        // Handle edge case of 24:xx from Intl 
        if (currentTimeStr.startsWith('24:')) {
            currentTimeStr = '00:' + currentTimeStr.substr(3);
        }

        const currentMinutes = parseTimeToMinutes(currentTimeStr);
        const startMinutes = parseTimeToMinutes(startStr);
        const endMinutes = parseTimeToMinutes(endStr);

        if (startMinutes <= endMinutes) {
            // Normal shift e.g. 09:00 - 18:00
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        } else {
            // Night shift e.g. 22:00 - 06:00
            return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
        }
    } catch (e) {
        console.error('Timezone parse error:', e);
        return true;
    }
}

function parseTimeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + (m || 0);
}
