import { Hono } from 'hono';
import { calculateHash } from '../utils/hash';
import { generateId, generateDeleteToken } from '../utils/nanoid';
import { createImage, getImageByHash } from '../db/queries';
import { checkRateLimit } from '../utils/rateLimiter';
import { isDriveEnabled, uploadToDrive } from '../utils/drive';
import { detectMimeTypeFromBuffer } from '../utils/magicBytes';
import { verifyTurnstile } from '../utils/turnstile';
import { Env } from '../types';

const uploadRoute = new Hono<{
    Bindings: Env;
}>();

const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml'
];

function getFileExtension(mimeType: string, originalName?: string | null): string {
    if (originalName && originalName.includes('.')) {
        const parts = originalName.split('.');
        const ext = parts[parts.length - 1].toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
            return ext === 'jpeg' ? 'jpg' : ext;
        }
    }
    const map: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/svg+xml': 'svg'
    };
    return map[mimeType] || 'png';
}

function isValidRemoteUrl(urlString: string): boolean {
    try {
        const parsed = new URL(urlString);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        if (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            (host.startsWith('172.') && parseInt(host.split('.')[1] || '0', 10) >= 16 && parseInt(host.split('.')[1] || '0', 10) <= 31) ||
            host.startsWith('169.254.') ||
            host.endsWith('.local') ||
            host.endsWith('.internal')
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

uploadRoute.post('/api/upload', async (c) => {
    try {
        const authHeader = c.req.header('Authorization');
        const apiKeyHeader = c.req.header('X-API-Key') || c.req.header('X-Auth-Key');
        const tokenQuery = c.req.query('key') || c.req.query('secret') || c.req.query('auth_key');

        let providedKey = apiKeyHeader || tokenQuery;
        if (!providedKey && authHeader) {
            if (authHeader.startsWith('Bearer ')) {
                providedKey = authHeader.slice(7).trim();
            } else {
                providedKey = authHeader.trim();
            }
        }

        let fileBuffer: ArrayBuffer | null = null;
        let mimeType: string = 'image/jpeg';
        let originalName: string = 'image.jpg';
        let remoteUrl: string | null = c.req.query('url') || null;
        let turnstileToken: string | null = (c.req.query('turnstile_token') || c.req.header('CF-Turnstile-Response')) as string || null;

        const contentTypeHeader = c.req.header('Content-Type') || '';

        if (contentTypeHeader.includes('application/json')) {
            try {
                const jsonBody = await c.req.json();
                if (jsonBody.url) {
                    remoteUrl = jsonBody.url;
                }
                if (jsonBody['cf-turnstile-response'] || jsonBody['turnstile_token']) {
                    turnstileToken = jsonBody['cf-turnstile-response'] || jsonBody['turnstile_token'];
                }
            } catch (e) {}
        } else {
            const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
            if (body['url']) {
                remoteUrl = body['url'] as string;
            }
            if (body['cf-turnstile-response'] || body['turnstile_token']) {
                turnstileToken = (body['cf-turnstile-response'] || body['turnstile_token']) as string;
            }
            const file = (body['file'] || body['image']) as File;
            if (file && typeof file !== 'string') {
                fileBuffer = await file.arrayBuffer();
                mimeType = file.type || 'image/jpeg';
                originalName = file.name || 'image.jpg';
            }
        }

        // 1. Authentication & Rate Limiting
        const expectedSecret = c.env.UPLOAD_SECRET;
        const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'anonymous';
        const isSecretAuthed = !!(expectedSecret && providedKey && providedKey === expectedSecret);

        if (providedKey && !isSecretAuthed) {
            return c.json({ success: false, error: 'Unauthorized: Invalid API secret key' }, 401);
        }

        // Rate limit: 1000/min for API key authed, 30/min for public web upload
        const maxLimit = isSecretAuthed ? 1000 : 30;
        const rateLimit = checkRateLimit(`upload:${clientIp}`, maxLimit, 60000);
        c.header('X-RateLimit-Limit', maxLimit.toString());
        c.header('X-RateLimit-Remaining', rateLimit.remaining.toString());

        if (!rateLimit.allowed) {
            c.header('Retry-After', rateLimit.resetInSec.toString());
            return c.json({
                success: false,
                error: `Too Many Requests: Rate limit exceeded. Please wait ${rateLimit.resetInSec} seconds before uploading again.`
            }, 429);
        }

        if (remoteUrl) {
            if (!isValidRemoteUrl(remoteUrl)) {
                return c.json({ success: false, error: 'Invalid or restricted remote URL' }, 400);
            }

            // Fetch directly from remote URL using Cloudflare Worker edge
            const remoteRes = await fetch(remoteUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (!remoteRes.ok) {
                return c.json({ success: false, error: `Failed to fetch remote image (HTTP ${remoteRes.status})` }, 400);
            }

            mimeType = remoteRes.headers.get('Content-Type') || 'image/jpeg';
            if (mimeType.includes(';')) {
                mimeType = mimeType.split(';')[0].trim();
            }

            fileBuffer = await remoteRes.arrayBuffer();
            const urlParts = remoteUrl.split('/');
            originalName = urlParts[urlParts.length - 1] || 'image.jpg';
        }

        if (!fileBuffer || fileBuffer.byteLength === 0) {
            return c.json({ success: false, error: 'No valid image file or URL provided' }, 400);
        }

        // 2. Validate Image Content with Magic Bytes & Allowed MIME Types
        const detectedMime = detectMimeTypeFromBuffer(fileBuffer);
        if (detectedMime) {
            mimeType = detectedMime;
        } else if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
            const ext = originalName.split('.').pop()?.toLowerCase();
            const inferred = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
            if (ALLOWED_MIME_TYPES.includes(inferred)) {
                mimeType = inferred;
            } else {
                return c.json({ success: false, error: `Invalid image content or unsupported format (${mimeType}).` }, 400);
            }
        }

        // 3. Compute SHA-256 hash of the file buffer
        const hash = await calculateHash(fileBuffer);

        const origin = new URL(c.req.url).origin;

        // 4. Deduplication Check
        const existingRecord = await getImageByHash(c.env.DB, hash);
        if (existingRecord) {
            const ext = getFileExtension(existingRecord.mime_type, existingRecord.original_name);
            const imageUrl = `${origin}/i/${existingRecord.id}.${ext}`;
            return c.json({
                success: true,
                id: existingRecord.id,
                url: imageUrl,
                direct_url: imageUrl,
                delete_url: `${origin}/api/delete/${existingRecord.id}?token=${existingRecord.delete_token}`,
                size: existingRecord.size_bytes,
                mime_type: existingRecord.mime_type,
                markdown: `![Image](${imageUrl})`,
                html: `<img src="${imageUrl}" alt="Image" />`,
                bbcode: `[IMG]${imageUrl}[/IMG]`
            });
        }

        // 5. Generate secure slug & delete token
        const id = generateId(6);
        const deleteToken = generateDeleteToken();
        const sizeBytes = fileBuffer.byteLength;
        if (sizeBytes > 10 * 1024 * 1024) {
            return c.json({ success: false, error: 'File too large (max 10 MB)' }, 413);
        }
        const ext = getFileExtension(mimeType, originalName);

        // 6. Optimized Parallel Storage: Google Drive primary + R2 fallback/retention concurrently
        const [driveFileId] = await Promise.all([
            isDriveEnabled(c.env)
                ? uploadToDrive(c.env, fileBuffer, `${id}.${ext}`, mimeType).catch((e: any) => {
                    console.error('Drive upload failed, falling back to R2 only:', e?.message || e);
                    return null;
                })
                : Promise.resolve(null),
            c.env.BUCKET.put(id, fileBuffer, {
                httpMetadata: { contentType: mimeType }
            })
        ]);

        // 7. Insert record into D1
        const record = {
            id,
            hash,
            original_name: originalName,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            delete_token: deleteToken,
            views: 0,
            created_at: Date.now(),
            drive_file_id: driveFileId,
            uploader_ip: clientIp
        };
        await createImage(c.env.DB, record);

        // 8. Return Response (201 Created)
        const imageUrl = `${origin}/i/${id}.${ext}`;
        return c.json({
            success: true,
            id: id,
            url: imageUrl,
            direct_url: imageUrl,
            delete_url: `${origin}/api/delete/${id}?token=${deleteToken}`,
            size: sizeBytes,
            mime_type: mimeType,
            markdown: `![Image](${imageUrl})`,
            html: `<img src="${imageUrl}" alt="Image" />`,
            bbcode: `[IMG]${imageUrl}[/IMG]`
        }, 201);

    } catch (err: any) {
        console.error('Upload route error:', err);
        return c.json({ success: false, error: err.message || 'Internal Server Error' }, 500);
    }
});

export default uploadRoute;
