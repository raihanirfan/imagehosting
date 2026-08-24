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
import backupRoute, { exportD1ToDrive } from './routes/backup';
import frontendRoute from './routes/frontend';
import { getImageById, lockImage, unlockImage } from './db/queries';

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
            "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https:; font-src 'self' data: https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests;"
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
app.route('/', backupRoute);

// Info Route — strip private fields
app.get('/api/info/:id', async (c) => {
    const id = c.req.param('id');
    const record = await getImageById(c.env.DB, id) as any;
    if (!record) {
        return c.json({ success: false, error: 'Not found' }, 404);
    }
    const { delete_token, uploader_ip, uploader_ip_enc, expires_at, ...publicData } = record as any;
    return c.json(publicData);
});

// Admin-only: reveal decrypted IP for a single image (DMCA / law enforcement)
// GET /api/admin/ip/:id  — requires Authorization: Bearer *** (header only, never ?key=)
app.get('/api/admin/ip/:id', async (c) => {
    const secret = c.env.UPLOAD_SECRET;
    const hdr = c.req.header('Authorization') || c.req.header('X-API-Key') || c.req.header('X-Auth-Key') || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : hdr.trim();
    if (!secret || token !== secret) return c.json({ success: false, error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    const row = await getImageById(c.env.DB, id) as any;
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    if (!row.uploader_ip_enc) return c.json({ success: true, id, uploader_ip: null, note: 'no encrypted IP (legacy row)' });
    try {
        const { decryptIp } = await import('./utils/hash');
        const ip = await decryptIp(row.uploader_ip_enc, secret);
        return c.json({ success: true, id, uploader_ip: ip, uploader_ip_hash: row.uploader_ip });
    } catch (e: any) {
        return c.json({ success: false, error: e?.message || 'decrypt failed' }, 500);
    }
});

// Admin DMCA lock / unlock — retain R2 bytes, block 451 until counter-notice
// POST /api/admin/lock/:id { reason?: string }  — Bearer UPLOAD_SECRET
// POST /api/admin/unlock/:id                — Bearer UPLOAD_SECRET
app.post('/api/admin/lock/:id', async (c) => {
    const secret = c.env.UPLOAD_SECRET;
    const hdr = c.req.header('Authorization') || c.req.header('X-API-Key') || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : hdr.trim();
    if (!secret || token !== secret) return c.json({ success: false, error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    const row = await getImageById(c.env.DB, id) as any;
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    if (row.locked_at) return c.json({ success: false, error: 'Already locked', locked_at: row.locked_at }, 409);
    let reason: string | undefined;
    try { reason = (await c.req.json() as any)?.reason; } catch {}
    await lockImage(c.env.DB, id, reason);
    const cache = caches.default;
    const origin = new URL(c.req.url).origin;
    const base = `${origin}/i/${id}`;
    await cache.delete(new Request(base)).catch(() => {});
    for (const ext of ['.webp','.png','.jpg','.jpeg','.gif','.svg']) await cache.delete(new Request(base + ext)).catch(() => {});
    return c.json({ success: true, id, locked: true, reason: reason || null });
});
app.post('/api/admin/unlock/:id', async (c) => {
    const secret = c.env.UPLOAD_SECRET;
    const hdr = c.req.header('Authorization') || c.req.header('X-API-Key') || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : hdr.trim();
    if (!secret || token !== secret) return c.json({ success: false, error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    const row = await getImageById(c.env.DB, id) as any;
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    if (!row.locked_at) return c.json({ success: false, error: 'Not locked' }, 409);
    await unlockImage(c.env.DB, id);
    return c.json({ success: true, id, locked: false });
});

// Fallback 404 for unhandled routes
app.notFound((c) => {
    return c.json({ success: false, error: 'Not Found' }, 404);
});

export default {
    fetch: app.fetch,
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(
            Promise.all([
                runKeepaliveJob(env.DB),
                exportD1ToDrive(env).catch((e) => console.error('Scheduled Drive backup error:', e))
            ])
        );
    }
};
