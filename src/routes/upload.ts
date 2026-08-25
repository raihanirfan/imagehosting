import { Hono } from 'hono';
import { calculateHash, hashIp, encryptIp } from '../utils/hash';
import { generateId, generateDeleteToken } from '../utils/nanoid';
import { createImage, getImageByHash } from '../db/queries';
import { checkRateLimit } from '../utils/rateLimiter';
import { isDriveEnabled, uploadToDrive, getOrCreateIpFolder } from '../utils/drive';
import { uploadToPixeldrain } from '../utils/pixeldrain';
import { uploadToBuzzheavier } from '../utils/buzzheavier';
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
        if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return false;
        if (parsed.username || parsed.password) return false;
        const host = parsed.hostname.toLowerCase();
        // 0.0.0.0 + private/loopback/link-local + cloud metadata + ULA/link-local ipv6
        if (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '0.0.0.0' ||
            host === '::1' ||
            host === '::ffff:127.0.0.1' ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            (host.startsWith('172.') && parseInt(host.split('.')[1] || '0', 10) >= 16 && parseInt(host.split('.')[1] || '0', 10) <= 31) ||
            host.startsWith('169.254.') ||
            host.startsWith('fc') ||          // fc00::/7 ULA (fc/fd)
            host.startsWith('fd') ||
            host.startsWith('fe80') ||        // fe80::/10 link-local
            host.endsWith('.local') ||
            host.endsWith('.internal') ||
            host.endsWith('.arpa')
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

// parse expiry like 1h, 24h, 168h, 720h, 0/never, or seconds number
function parseExpiryMs(raw: string | null): number | null {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase();
    if (s === '0' || s === 'never' || s === 'permanent' || s === '') return null;
    const m = s.match(/^(\d+)\s*(h|hour|hours|d|day|days)?$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = (m[2] || 'h').toLowerCase();
        if (unit.startsWith('d')) return n * 24 * 3600 * 1000;
        return n * 3600 * 1000;
    }
    return null;
}

uploadRoute.post('/api/upload', async (c) => {
    try {
        const authHeader = c.req.header('Authorization');
        const apiKeyHeader = c.req.header('X-API-Key') || c.req.header('X-Auth-Key');

        let providedKey: string | undefined = apiKeyHeader || undefined;
        if (!providedKey && authHeader) {
            if (authHeader.startsWith('Bearer ')) {
                providedKey = authHeader.slice(7).trim();
            } else {
                providedKey = authHeader.trim();
            }
        }
        // ponytail: ?key= query param removed — leaks in logs/CDN; use header Bearer/X-API-Key only

        let fileBuffer: ArrayBuffer | null = null;
        let mimeType: string = 'image/jpeg';
        let originalName: string = 'image.jpg';
        let remoteUrl: string | null = c.req.query('url') || null;
        let turnstileToken: string | null = (c.req.query('turnstile_token') || c.req.header('CF-Turnstile-Response')) as string || null;
        let expiryParam: string | null = (c.req.query('expiry') || c.req.query('expires') || c.req.query('ttl')) as string || null;

        const contentTypeHeader = c.req.header('Content-Type') || '';

        if (contentTypeHeader.includes('application/json')) {
            try {
                const jsonBody = await c.req.json();
                if (jsonBody.url) {
                    remoteUrl = jsonBody.url;
                }
                if (jsonBody['expiry'] || jsonBody['expires'] || jsonBody['ttl']) {
                    expiryParam = String(jsonBody['expiry'] || jsonBody['expires'] || jsonBody['ttl'] || '');
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
            if (body['expiry'] || body['expires'] || body['ttl']) {
                expiryParam = String(body['expiry'] || body['expires'] || body['ttl'] || '');
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

            // Fetch directly from remote URL — manual redirect to block SSRF via 302 to private IP
            const remoteRes = await fetch(remoteUrl, {
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            // block redirects — prevents SSRF via open-redirector
            if ([301, 302, 303, 307, 308].includes(remoteRes.status)) {
                return c.json({ success: false, error: 'Redirect not allowed for remote URL' }, 400);
            }

            if (!remoteRes.ok) {
                return c.json({ success: false, error: `Failed to fetch remote image (HTTP ${remoteRes.status})` }, 400);
            }

            // pre-check Content-Length — cheap rejection before downloading huge body
            const cl = remoteRes.headers.get('Content-Length');
            if (cl && parseInt(cl, 10) > 10 * 1024 * 1024) {
                return c.json({ success: false, error: 'Remote file too large (max 10 MB)' }, 413);
            }

            fileBuffer = await remoteRes.arrayBuffer();
            if (fileBuffer.byteLength > 10 * 1024 * 1024) {
                return c.json({ success: false, error: 'Remote file too large (max 10 MB)' }, 413);
            }
            mimeType = remoteRes.headers.get('Content-Type')?.split(';')[0].trim() || 'image/jpeg';
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
                delete_url: `${origin}/api/delete/${existingRecord.id}`,
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

        // 6. Optimized Parallel Storage: Google Drive per-IP folder + R2 concurrently
        // ponytail: 1 extra Drive API call (getOrCreateIpFolder) per new IP, cached per-isolate
        const ipFolderId = isDriveEnabled(c.env) ? await getOrCreateIpFolder(c.env, clientIp).catch(() => c.env.GOOGLE_FOLDER_ID || null) : null;
        const [driveFileId] = await Promise.all([
            isDriveEnabled(c.env)
                ? uploadToDrive(c.env, fileBuffer, `${id}.${ext}`, mimeType, ipFolderId).catch((e: any) => {
                    console.error('Drive upload failed, falling back to R2 only:', e?.message || e);
                    return null;
                })
                : Promise.resolve(null),
            c.env.BUCKET.put(id, fileBuffer, {
                httpMetadata: { contentType: mimeType }
            })
        ]);

        // 7. Insert record into D1
        const salt = c.env.UPLOAD_SECRET || 'imgof_salt_2026';
        const [hashedIp, encIp] = await Promise.all([
            clientIp ? hashIp(clientIp, salt) : Promise.resolve(null as any),
            clientIp && clientIp !== 'anonymous' ? encryptIp(clientIp, salt).catch(() => null as any) : Promise.resolve(null as any),
        ]);
        const record: any = {
            id,
            hash,
            original_name: originalName,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            delete_token: deleteToken,
            views: 0,
            created_at: Date.now(),
            drive_file_id: driveFileId,
            uploader_ip: hashedIp,
            uploader_ip_enc: encIp,
            expires_at: (() => { const ms = parseExpiryMs(expiryParam); return ms ? Date.now() + ms : null; })(),
        };
        await createImage(c.env.DB, record);

        // 7b. Asynchronous Background Backup to Pixeldrain + Buzzheavier (Zero latency overhead for client)
        if (c.executionCtx && c.executionCtx.waitUntil) {
            c.executionCtx.waitUntil((async () => {
                try {
                    const [pdResult, buzzResult] = await Promise.allSettled([
                        uploadToPixeldrain(fileBuffer, `${id}.${ext}`, c.env.PIXELDRAIN_API_KEY),
                        uploadToBuzzheavier(fileBuffer, `${id}.${ext}`, c.env.BUZZHEAVIER_API_KEY)
                    ]);
                    const pd = pdResult.status === 'fulfilled' ? pdResult.value : null;
                    const bz = buzzResult.status === 'fulfilled' ? buzzResult.value : null;
                    if (pd?.id) await c.env.DB.prepare('UPDATE images SET pixeldrain_id = ? WHERE id = ?').bind(pd.id, id).run().catch(()=>{});
                    if (bz?.id) await c.env.DB.prepare('UPDATE images SET buzzheavier_id = ? WHERE id = ?').bind(bz.id, id).run().catch(()=>{});
                    if (pdResult.status === 'rejected') console.error('Background Pixeldrain upload error:', (pdResult.reason as any)?.message || pdResult.reason);
                    if (buzzResult.status === 'rejected') console.error('Background Buzzheavier upload error:', (buzzResult.reason as any)?.message || buzzResult.reason);
                } catch (err: any) {
                    console.error('Background external upload error:', err?.message || err);
                }
            })());
        }

        // 8. Return Response (201 Created)
        const imageUrl = `${origin}/i/${id}.${ext}`;
        return c.json({
            success: true,
            id: id,
            url: imageUrl,
            direct_url: imageUrl,
            delete_url: `${origin}/api/delete/${id}`,
            size: sizeBytes,
            mime_type: mimeType,
            markdown: `![Image](${imageUrl})`,
            html: `<img src="${imageUrl}" alt="Image" />`,
            bbcode: `[IMG]${imageUrl}[/IMG]`
        }, 201);

    } catch (err: any) {
        console.error('Upload route error:', err);
        return c.json({ success: false, error: 'Internal Server Error' }, 500);
    }
});

export default uploadRoute;
