/**
 * Export and File Proxy Handlers
 * 导出和文件代理处理程序
 */
import { config } from '../config.js';
import { db, d1 } from './db.js';
import { requestTelegram } from './telegram.js';
import { hmacHex, listDateKeysInclusive, formatDateKeyUTC, renderExportHtml } from '../utils/utils.js';

export async function handleFileProxy(request) {
    const url = new URL(request.url)
    const fileId = url.searchParams.get('file_id')
    const auth = url.searchParams.get('auth')
    const exp = parseInt(url.searchParams.get('exp') || '0', 10)

    if (!config.EXPORT_SECRET) return new Response('Unauthorized', { status: 401 })
    if (!fileId || !auth || !exp) return new Response('Bad Request', { status: 400 })
    if (Date.now() > exp) return new Response('Link expired', { status: 410 })

    const toSign = `${fileId}.${exp}`
    // Verify signature
    // 验证签名
    const expected = await hmacHex(config.EXPORT_SECRET, toSign)

    if (expected !== auth) return new Response('Unauthorized', { status: 401 })

    try {
        // Fetch file from Telegram
        // 从 Telegram 获取文件
        const urlRes = await requestTelegram('getFile', null, { file_id: fileId })
        const filePath = urlRes?.result?.file_path
        if (!filePath) return new Response('Not Found', { status: 404 })

        const tgFile = await fetch(`https://api.telegram.org/file/bot${config.TOKEN}/${filePath}`)
        return new Response(tgFile.body, {
            headers: {
                'Content-Type': tgFile.headers.get('content-type') || 'application/octet-stream',
                'Cache-Control': 'no-store'
            }
        })
    } catch (e) {
        return new Response('Error fetching file', { status: 500 })
    }
}

export async function handleExport(request) {
    const url = new URL(request.url)
    const userId = url.searchParams.get('user_id')
    const day = url.searchParams.get('date') || undefined
    const start = url.searchParams.get('start')
    const end = url.searchParams.get('end')
    const format = url.searchParams.get('format') || 'json'
    const auth = url.searchParams.get('auth')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '0', 10) || 0, 5000)
    let offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)
    const cursor = url.searchParams.get('cursor')
    const sig = url.searchParams.get('sig')
    const ts = url.searchParams.get('ts')
    const targetId = url.searchParams.get('target_id')

    // Validate signature
    // 验证签名
    let authorized = false
    if (config.EXPORT_SECRET && auth === config.EXPORT_SECRET) authorized = true
    if (!authorized && config.EXPORT_SECRET && sig && ts) {
        const now = Date.now()
        const tsNum = parseInt(ts, 10)
        if (!isNaN(tsNum) && Math.abs(now - tsNum) < 10 * 60 * 1000) {
            const data = `${ts}.${userId}.${targetId || ''}`
            const expected = await hmacHex(config.EXPORT_SECRET, data)
            if (expected === sig) authorized = true
        }
    }

    if (!authorized) return new Response('Unauthorized', { status: 401 })
    if (!targetId) return new Response('Missing target_id', { status: 400 })

    // Parse date range
    // 解析日期范围
    let dateKeys = []
    if (start && end) {
        dateKeys = listDateKeysInclusive(start, end)
        if (dateKeys.length === 0) return new Response('Invalid date range', { status: 400 })
    } else {
        const chosen = day || formatDateKeyUTC()
        dateKeys = [chosen]
    }

    // Fetch logs from SQL
    // 从 SQL 获取日志
    let logs = []

    // Instead of looping, we can use an IN clause if dateKeys is manageable,
    // or just fetch by user_id and then filter. Let's build IN clause.
    if (dateKeys.length > 0) {
        const placeholders = dateKeys.map(() => '?').join(',');
        const query = `
            SELECT * FROM message_logs 
            WHERE user_id = ? AND date_key IN (${placeholders}) 
            ORDER BY created_at ASC
        `;

        try {
            const stmt = d1.prepare(query);
            const res = await stmt.bind(targetId.toString(), ...dateKeys).all();
            if (res && res.results) {
                // Map to legacy format expected by renderExportHtml
                logs = res.results.map(row => ({
                    t: row.created_at,
                    dir: row.direction,
                    mid: row.message_id,
                    type: row.type || 'text',
                    text: row.text,
                    caption: row.caption,
                    file_id: row.file_id,
                    file_unique_id: row.file_unique_id,
                    file_name: row.file_name,
                    mime_type: row.mime_type,
                    file_size: row.file_size,
                    width: row.width,
                    height: row.height,
                    duration: row.duration,
                    performer: row.performer,
                    title: row.title,
                    emoji: row.emoji,
                    set_name: row.set_name,
                    is_animated: row.is_animated,
                    is_video: row.is_video,
                    length: row.length,
                    _date: row.date_key
                }));
            }
        } catch (e) {
            console.error('Error fetching logs for export:', e);
        }
    }

    // Sort logs
    // 排序日志
    logs.sort((a, b) => (a.t || 0) - (b.t || 0))
    const total = logs.length

    // Pagination
    // 分页
    if (cursor) {
        try {
            const decoded = JSON.parse(atob(cursor))
            if (decoded && typeof decoded.offset === 'number') offset = decoded.offset
        } catch (e) { }
    }

    const sliced = limit > 0 ? logs.slice(offset, offset + limit) : logs
    const nextCursor = limit > 0 && offset + limit < total ? btoa(JSON.stringify({ offset: offset + limit })) : null

    const noStoreHeaders = { 'Cache-Control': 'no-store' }

    // Render HTML or JSON
    // 渲染 HTML 或 JSON
    if (format === 'html') {
        const title = `Export - ${targetId}`
        const html = renderExportHtml(title, sliced)
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', ...noStoreHeaders } })
    } else {
        return new Response(JSON.stringify({
            user_id: targetId,
            total,
            limit: limit || undefined,
            offset: offset || undefined,
            next_cursor: nextCursor,
            logs: sliced
        }, null, 2), {
            headers: { 'content-type': 'application/json', ...noStoreHeaders }
        })
    }
}
