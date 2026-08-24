import { Hono } from 'hono';
import { getImageById, deleteImageRecord } from '../db/queries';
import { checkRateLimit } from '../utils/rateLimiter';
import { notifyTelegram } from '../utils/telegram';
import { Env } from '../types';

const deleteRoute = new Hono<{ Bindings: Env }>();
 
// Supports DELETE and POST: /api/delete/:id
deleteRoute.on(['DELETE', 'POST'], '/api/delete/:id', async (c) => {
    // 0. Rate Limiting Check (Max 20 delete attempts per minute per IP)
    const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'anonymous';
    const rateLimit = checkRateLimit(`delete:${clientIp}`, 20, 60000);

    c.header('X-RateLimit-Limit', '20');
    c.header('X-RateLimit-Remaining', rateLimit.remaining.toString());

    if (!rateLimit.allowed) {
        c.header('Retry-After', rateLimit.resetInSec.toString());
        return c.json({
            success: false,
            error: `Too Many Requests: Delete rate limit exceeded. Please wait ${rateLimit.resetInSec} seconds before retrying.`
        }, 429);
    }

    const rawId = c.req.param('id');
    const id = rawId.replace(/\.[^/.]+$/, '');
    
    // 1. Extract token/secret from query, headers, or body
    let token = c.req.query('token') || c.req.query('secret') || c.req.query('key');

    const authHeader = c.req.header('Authorization');
    const apiKeyHeader = c.req.header('X-API-Key') || c.req.header('X-Auth-Key');
    
    if (!token && apiKeyHeader) {
        token = apiKeyHeader;
    }

    if (!token && authHeader) {
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        } else {
            token = authHeader.trim();
        }
    }

    // Fallback to JSON payload or form data if not found
    if (!token) {
        try {
            const body = await c.req.json();
            token = body.token || body.secret || body.key;
        } catch (e) {
            // Not a JSON payload
        }
    }
    
    if (!token) {
        try {
            const form = await c.req.parseBody();
            token = (form.token || form.secret || form.key) as string;
        } catch (e) {
            // Not form data
        }
    }

    if (!token) {
        return c.json({ success: false, error: 'Deletion token or Admin Secret Key is required' }, 400);
    }

    // 2. Validate image record in D1 database
    const image = await getImageById(c.env.DB, id);
    if (!image) {
        return c.json({ success: false, error: 'Image not found' }, 404);
    }

    // 3. Authorization Check: Admin Secret Key OR Individual Delete Token
    const isMasterAdmin = c.env.UPLOAD_SECRET && token === c.env.UPLOAD_SECRET;
    const isOwnerToken = image.delete_token === token;

    if (!isMasterAdmin && !isOwnerToken) {
        return c.json({ success: false, error: 'Invalid deletion token or unauthorized' }, 403);
    }

    // 4. R2-only delete — Drive/Pixeldrain/Buzz retained per policy (soft-delete: link mati, file eksternal tetap untuk backup/restore)
    // ponytail: external delete via explicit admin purge only

    // notify telegram (non-blocking) — only if configured
    const origin = new URL(c.req.url).origin;
    const notifText = `🗑️ <b>Delete</b> <code>${id}</code> — ${image.original_name || 'unnamed'} (${image.mime_type}, ${(image.size_bytes/1024).toFixed(1)}KB, ${image.views} views)\n${origin}/i/${id} • by ${isMasterAdmin ? 'admin' : 'owner'} • ${clientIp}`;
    try { c.executionCtx.waitUntil(notifyTelegram(c.env, notifText)); } catch {}

    // 4b. Delete file from R2 Bucket
    await c.env.BUCKET.delete(id);

    // 5. Delete metadata record from D1
    await deleteImageRecord(c.env.DB, id);

    // 6. Invalidate Cloudflare Edge Cache
    const cache = caches.default;
    
    // Delete base image URL from cache
    const imageUrl = `${origin}/i/${id}`;
    await cache.delete(new Request(imageUrl));

    // Also delete possible extension variations (e.g. webp, png, jpg, jpeg, gif, svg)
    const extensions = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg'];
    for (const ext of extensions) {
        await cache.delete(new Request(`${imageUrl}${ext}`));
    }

    return c.json({ 
        success: true, 
        message: isMasterAdmin 
            ? 'Image deleted permanently using Admin Secret Key.' 
            : 'Image deleted permanently.' 
    });
});

export default deleteRoute;
