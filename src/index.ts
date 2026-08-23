import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { BLOCKED_IPS, ALLOWED_IPS } from './config/blocked_ips';
import uploadRoute from './routes/upload';
import serveRoute from './routes/serve';
import deleteRoute from './routes/delete';
import migrateRoute from './routes/migrate';
import statsRoute from './routes/stats';
import keepaliveRoute, { runKeepaliveJob } from './routes/keepalive';
import frontendRoute from './routes/frontend';
import { getImageById } from './db/queries';

const app = new Hono<{ Bindings: Env }>();

// 1. IP & IPv6 Access Control Middleware (Allowlist & Blocklist)
app.use('*', async (c, next) => {
    const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '';
    
    // Check Allowlist First (Admin / Whitelist IP is 100% immune from blocklist)
    if (clientIp) {
        if (ALLOWED_IPS.has(clientIp)) {
            await next();
            return;
        }
        if (c.env.ALLOWED_IPS) {
            const envAllowedList = c.env.ALLOWED_IPS.split(',').map(ip => ip.trim());
            if (envAllowedList.includes(clientIp)) {
                await next();
                return;
            }
        }
    }

    // Check Blocklist (Static file)
    if (clientIp && BLOCKED_IPS.has(clientIp)) {
        return c.json({
            success: false,
            error: 'Access Denied: Your IP address has been blocked by the administrator.'
        }, 403);
    }

    // Check Blocklist (Dynamic environment variable)
    if (clientIp && c.env.BLOCKED_IPS) {
        const envBlockedList = c.env.BLOCKED_IPS.split(',').map(ip => ip.trim());
        if (envBlockedList.includes(clientIp)) {
            return c.json({
                success: false,
                error: 'Access Denied: Your IP address has been blocked by the administrator.'
            }, 403);
        }
    }

    await next();
});

app.use('*', cors());

// Canonical domain redirect — only for GET (image views), not for POST upload/delete (ponytail: 301 breaks POST)
app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.hostname === 'image-hosting.irfanraihanal.workers.dev' && c.req.method === 'GET') {
        url.hostname = 'imgof.my.id';
        url.protocol = 'https:';
        return c.redirect(url.toString(), 301);
    }
    await next();
});

// Global Security Headers Middleware
app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    c.res.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    
    // Content-Security-Policy (Strict CSP with Cloudflare Web Analytics whitelist)
    if (!c.res.headers.has('Content-Security-Policy')) {
        c.res.headers.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https:; font-src 'self' data: https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests;"
        );
    }
});

// Mounting Sub-Routes
app.route('/', frontendRoute);
app.route('/', uploadRoute);
app.route('/', serveRoute);
app.route('/', deleteRoute);
app.route('/', migrateRoute);
app.route('/', statsRoute);
app.route('/', keepaliveRoute);

// Info Route
app.get('/api/info/:id', async (c) => {
    const id = c.req.param('id');
    const record = await getImageById(c.env.DB, id);
    if (!record) {
        return c.json({ success: false, error: 'Not found' }, 404);
    }
    const { delete_token, uploader_ip, ...publicData } = record;
    return c.json(publicData);
});

// Fallback 404 for unhandled routes
app.notFound((c) => {
    return c.json({ success: false, error: 'Not Found' }, 404);
});

export default {
    fetch: app.fetch,
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(runKeepaliveJob(env.DB));
    }
};
