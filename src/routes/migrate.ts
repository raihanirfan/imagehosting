import { Hono } from 'hono';
import { Env } from '../types';
import { isDriveEnabled, getAccessToken } from '../utils/drive';
import { getImageById } from '../db/queries';

const migrateRoute = new Hono<{ Bindings: Env }>();

// POST /api/migrate-to-drive?limit=50 — header Bearer only (never ?key=, avoids log leak)
// ponytail: batch + cursor, no queue; upgrade to Queues when >10k files or needs resume across deploys
migrateRoute.post('/api/migrate-to-drive', async (c) => {
    const hdr = c.req.header('Authorization') || c.req.header('X-API-Key') || '';
    const key = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : hdr.trim() || '';
    if (!c.env.UPLOAD_SECRET || key !== c.env.UPLOAD_SECRET) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!isDriveEnabled(c.env)) {
        return c.json({ success: false, error: 'Drive not configured (missing GOOGLE_* secrets)' }, 400);
    }
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 50);
    const cursor = c.req.query('cursor') || null; // last id

    // fetch pending rows ordered by id for stable pagination (static parameterized queries for static analysis)
    const dbQuery = cursor
        ? c.env.DB.prepare('SELECT id, mime_type, drive_file_id FROM images WHERE drive_file_id IS NULL AND id > ? ORDER BY id ASC LIMIT ?').bind(cursor, limit)
        : c.env.DB.prepare('SELECT id, mime_type, drive_file_id FROM images WHERE drive_file_id IS NULL ORDER BY id ASC LIMIT ?').bind(limit);

    const { results: rows } = await dbQuery.all<any>();
    if (!rows || rows.length === 0) {
        return c.json({ success: true, migrated: 0, next_cursor: null, done: true });
    }

    const token = await getAccessToken(c.env);
    const boundaryBase = 'migrate_' + Date.now();

    let migrated = 0;
    let failed: any[] = [];
    let lastId = cursor;

    for (const row of rows) {
        lastId = row.id;
        try {
            const obj = await c.env.BUCKET.get(row.id);
            if (!obj) {
                // R2 missing but D1 exists — skip, will be caught as 404 on serve
                failed.push({ id: row.id, error: 'R2 object not found' });
                continue;
            }
            const buf = await obj.arrayBuffer();
            const mime = row.mime_type || obj.httpMetadata?.contentType || 'image/jpeg';
            const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : mime === 'image/svg+xml' ? 'svg' : 'bin';
            const name = `${row.id}.${ext}`;

            // multipart upload to Drive
            const boundary = boundaryBase + '_' + row.id;
            const metadata: any = { name };
            if (c.env.GOOGLE_FOLDER_ID) metadata.parents = [c.env.GOOGLE_FOLDER_ID];
            const enc = new TextEncoder();
            const header1 = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
            const footer = enc.encode(`\r\n--${boundary}--`);
            const body = new Uint8Array(header1.length + buf.byteLength + footer.length);
            body.set(header1, 0);
            body.set(new Uint8Array(buf), header1.length);
            body.set(footer, header1.length + buf.byteLength);

            const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                body: body as any,
            });
            if (!up.ok) {
                const txt = await up.text();
                throw new Error(`upload ${up.status}: ${txt.slice(0,300)}`);
            }
            const { id: fileId } = await up.json() as any;
            // best-effort public
            try {
                await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
                });
            } catch {}

            await c.env.DB.prepare('UPDATE images SET drive_file_id = ? WHERE id = ?').bind(fileId, row.id).run();
            migrated++;

            // small throttle to avoid 429 on burst
            if (migrated % 5 === 0) await new Promise(r => setTimeout(r, 200));
        } catch (e: any) {
            failed.push({ id: row.id, error: e?.message || String(e) });
        }
    }

    const next_cursor = rows.length < limit ? null : lastId;
    const done = next_cursor === null;
    return c.json({ success: true, migrated, failed, next_cursor, done, limit, cursor });
});

export default migrateRoute;
