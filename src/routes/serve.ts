import { Hono } from 'hono';
import { getImageById, incrementViewCount } from '../db/queries';
import { isDriveEnabled, fetchFromDrive } from '../utils/drive';
import { fetchFromPixeldrain } from '../utils/pixeldrain';
import { fetchFromBuzzheavier } from '../utils/buzzheavier';
import { checkRateLimit } from '../utils/rateLimiter';
import { Env } from '../types';

const viewRoute = new Hono<{ Bindings: Env }>();

viewRoute.get('/i/:id', async (c) => {
    const rawId = c.req.param('id');
    const clientIp = c.req.header('CF-Connecting-IP') || 'anon';
    
    // Extract clean ID (remove extension like .webp, .png, .jpg if present)
    const cleanId = rawId.replace(/\.[^/.]+$/, '');

    const recordViewIfAllowed = (targetId: string) => {
        const limitCheck = checkRateLimit(`view:${targetId}:${clientIp}`, 1, 10000);
        if (limitCheck.allowed) {
            c.executionCtx.waitUntil(incrementViewCount(c.env.DB, targetId).catch(() => {}));
        }
    };

    // 1. Check Cloudflare Edge Cache first
    const cache = caches.default;
    const cacheResponse = await cache.match(c.req.raw);
    if (cacheResponse) {
        recordViewIfAllowed(cleanId);
        return cacheResponse;
    }

    // 2. Find metadata in D1 (try cleanId first, fallback to rawId)
    let imageRecord = await getImageById(c.env.DB, cleanId);
    if (!imageRecord) {
        imageRecord = await getImageById(c.env.DB, rawId);
    }

    // 3. Try Drive first if record has drive_file_id and Drive is configured
    let externalRes: Response | null = null;
    if (imageRecord?.drive_file_id && isDriveEnabled(c.env)) {
        try {
            externalRes = await fetchFromDrive(c.env, imageRecord.drive_file_id);
        } catch (e) {
            console.error('Drive fetch failed:', (e as any)?.message || e);
        }
    }

    // 4. Try Pixeldrain if Drive missed/not configured
    if (!externalRes && imageRecord?.pixeldrain_id) {
        try {
            externalRes = await fetchFromPixeldrain(imageRecord.pixeldrain_id, c.env.PIXELDRAIN_API_KEY);
        } catch (e) {
            console.error('Pixeldrain fetch failed:', (e as any)?.message || e);
        }
    }

    // 5. Try Buzzheavier if Pixeldrain missed
    if (!externalRes && imageRecord?.buzzheavier_id) {
        try {
            externalRes = await fetchFromBuzzheavier(imageRecord.buzzheavier_id, c.env.BUZZHEAVIER_API_KEY);
        } catch (e) {
            console.error('Buzzheavier fetch failed:', (e as any)?.message || e);
        }
    }

    if (externalRes) {
        if (imageRecord) {
            recordViewIfAllowed(imageRecord.id);
        }
        const headers = new Headers();
        const mimeType = imageRecord?.mime_type || externalRes.headers.get('Content-Type') || 'image/webp';
        headers.set('Content-Type', mimeType);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Accept-Ranges', 'bytes');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        if (mimeType === 'image/svg+xml') {
            headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        }
        const etag = externalRes.headers.get('ETag');
        if (etag) headers.set('ETag', etag);

        const response = new Response(externalRes.body, { headers });
        c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
        return response;
    }

    // R2 fallback — retention path for old images and when external storage miss/fail
    const targetKey = imageRecord ? imageRecord.id : cleanId;
    let object = await c.env.BUCKET.get(targetKey);
    if (!object) {
        object = await c.env.BUCKET.get(rawId);
    }

const NOT_FOUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <rect x="150" y="100" width="500" height="400" rx="16" fill="#1e293b" stroke="#334155" stroke-width="2"/>
  <circle cx="400" cy="230" r="50" fill="#334155"/>
  <path d="M380 210 L420 250 M420 210 L380 250" stroke="#94a3b8" stroke-width="5" stroke-linecap="round"/>
  <text x="400" y="330" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="bold" fill="#f8fafc" text-anchor="middle">Image Not Found</text>
  <text x="400" y="365" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">This image has been deleted or does not exist</text>
  <text x="400" y="440" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="600" fill="#38bdf8" text-anchor="middle">ImgOF — imgof.my.id</text>
</svg>`;

    // If still not found in R2 / Drive
    if (!object) {
        const accept = c.req.header('Accept') || '';
        if (accept.includes('application/json')) {
            return c.json({ success: false, error: 'Image Not Found' }, 404);
        }
        return new Response(NOT_FOUND_SVG, {
            status: 404,
            headers: {
                'Content-Type': 'image/svg+xml; charset=UTF-8',
                'Cache-Control': 'public, max-age=60',
                'X-Content-Type-Options': 'nosniff'
            }
        });
    }

    // 4. Increment view count asynchronously with debouncing
    if (imageRecord) {
        recordViewIfAllowed(imageRecord.id);
    }

    // 5. Set response headers for maximum caching, delivery & security
    const headers = new Headers();
    const mimeType = imageRecord?.mime_type || object.httpMetadata?.contentType || 'image/webp';
    
    headers.set('Content-Type', mimeType);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Sandbox SVG images to prevent XSS / script execution
    if (mimeType === 'image/svg+xml') {
        headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }

    if (object.httpEtag) {
        headers.set('ETag', object.httpEtag);
    }

    const response = new Response(object.body, { headers });

    // 6. Save response in Cloudflare Edge Cache in background
    c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));

    return response;
});

export default viewRoute;
