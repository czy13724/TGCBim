/**
 * Main Worker Entry Point
 * 主工作线程入口点
 */
import { initConfig, config } from './config.js';
import { initDb } from './services/db.js';
import { handleWebhook, registerWebhook, unRegisterWebhook, handleHealthCheck } from './core/bot.js';
import { handleFileProxy, handleExport } from './services/export.js';

export default {
    async fetch(request, env, ctx) {
        // Initialize configuration and database from environment
        // 从环境变量初始化配置和数据库
        initConfig(env);
        initDb(env);

        const url = new URL(request.url)

        // Handle Base Path
        // 处理基本路径
        let pathname = url.pathname
        if (config.BASE_PATH && pathname.startsWith(config.BASE_PATH)) {
            pathname = pathname.slice(config.BASE_PATH.length) || '/'
        }

        // Routing
        // 路由
        try {
            switch (pathname) {
                case '/':
                    // Default bot behavior
                    // 默认机器人行为
                    if (request.method === 'POST') {
                        return await handleWebhook({
                            request,
                            waitUntil: (p) => ctx.waitUntil(p)
                        })
                    }
                    return new Response('Bot is running. Available endpoints: /health', { status: 200 })

                case config.WEBHOOK:
                    return await handleWebhook({
                        request,
                        waitUntil: (p) => ctx.waitUntil(p)
                    })

                case '/registerWebhook':
                    return await registerWebhook(url)

                case '/unRegisterWebhook':
                    return await unRegisterWebhook()

                case '/health':
                    return await handleHealthCheck()

                case '/file':
                    return await handleFileProxy(request)

                case '/export':
                    return await handleExport(request)

                default:
                    // Fallback
                    // 兜底逻辑
                    if (pathname === config.WEBHOOK) { // In case config.WEBHOOK matches logic above
                        return await handleWebhook({ request, waitUntil: (p) => ctx.waitUntil(p) })
                    }
                    return new Response('Bot is running. Available endpoints: /health', {
                        headers: { 'content-type': 'text/plain' }
                    })
            }
        } catch (error) {
            console.error('Worker error:', error)
            return new Response('Internal Server Error', { status: 500 })
        }
    }
}
