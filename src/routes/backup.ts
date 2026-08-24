import { Hono } from 'hono';
import { isDriveEnabled, uploadToDrive } from '../utils/drive';
import { Env, ImageRecord } from '../types';

const backupRoute = new Hono<{ Bindings: Env }>();

export async function exportD1ToDrive(env: Env): Promise<{
    success: boolean;
    filename: string;
    drive_file_id?: string;
    total_records: number;
    size_bytes: number;
    error?: string;
}> {
    if (!isDriveEnabled(env)) {
        throw new Error('Google Drive integration is not configured.');
    }

    // 1. Fetch all records from D1
    const { results } = await env.DB.prepare('SELECT * FROM images ORDER BY created_at ASC').all<ImageRecord>();
    const records = results || [];

    // 2. Generate clean standard SQL dump
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `d1_backup_${timestamp}.sql`;

    const sqlLines: string[] = [
        `-- ==============================================================================`,
        `-- ImgOF Cloudflare D1 Remote Database Backup`,
        `-- Exported At: ${new Date().toISOString()}`,
        `-- Total Records: ${records.length}`,
        `-- ==============================================================================`,
        ``,
        `CREATE TABLE IF NOT EXISTS images (`,
        `    id TEXT PRIMARY KEY,`,
        `    hash TEXT NOT NULL UNIQUE,`,
        `    original_name TEXT,`,
        `    mime_type TEXT NOT NULL,`,
        `    size_bytes INTEGER NOT NULL,`,
        `    delete_token TEXT NOT NULL,`,
        `    views INTEGER DEFAULT 0,`,
        `    created_at INTEGER NOT NULL,`,
        `    drive_file_id TEXT,`,
        `    uploader_ip TEXT,`,
        `    uploader_ip_enc TEXT,`,
        `    pixeldrain_id TEXT,`,
        `    buzzheavier_id TEXT,`,
        `    expires_at INTEGER`,
        `);`,
        ``,
        `CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash);`,
        `CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);`,
        `CREATE INDEX IF NOT EXISTS idx_images_pixeldrain ON images(pixeldrain_id);`,
        `CREATE INDEX IF NOT EXISTS idx_images_buzzheavier ON images(buzzheavier_id);`,
        `CREATE INDEX IF NOT EXISTS idx_images_expires_at ON images(expires_at);`,
        ``
    ];

    // Build batch INSERT statements
    const escapeSql = (val: any) => {
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return val.toString();
        return `'${String(val).replace(/'/g, "''")}'`;
    };

    for (let i = 0; i < records.length; i += 50) {
        const chunk = records.slice(i, i + 50);
        const values = chunk.map(r =>
            `(${escapeSql(r.id)}, ${escapeSql(r.hash)}, ${escapeSql(r.original_name)}, ${escapeSql(r.mime_type)}, ${r.size_bytes}, ${escapeSql(r.delete_token)}, ${r.views || 0}, ${r.created_at}, ${escapeSql(r.drive_file_id)}, ${escapeSql(r.uploader_ip)}, ${escapeSql((r as any).uploader_ip_enc)}, ${escapeSql(r.pixeldrain_id)}, ${escapeSql(r.buzzheavier_id)}, ${(r as any).expires_at ?? 'NULL'})`
        ).join(',\n');

        sqlLines.push(`INSERT OR IGNORE INTO images (id, hash, original_name, mime_type, size_bytes, delete_token, views, created_at, drive_file_id, uploader_ip, uploader_ip_enc, pixeldrain_id, buzzheavier_id, expires_at) VALUES\n${values};`);
    }

    const sqlContent = sqlLines.join('\n');
    const enc = new TextEncoder();
    const uint8 = enc.encode(sqlContent);
    const sqlBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer;

    // 3. Upload directly to Google Drive
    const driveFileId = await uploadToDrive(env, sqlBuffer, filename, 'text/plain');

    return {
        success: true,
        filename,
        drive_file_id: driveFileId,
        total_records: records.length,
        size_bytes: sqlBuffer.byteLength
    };
}

// Admin Trigger Endpoint — header only (never ?key= in URL, avoids log leak)
backupRoute.post('/api/backup-drive', async (c) => {
    const hdr = c.req.header('Authorization') || c.req.header('X-API-Key') || c.req.header('X-Auth-Key') || '';
    let providedKey = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : hdr.trim();
    if (!providedKey) providedKey = '';

    const expectedSecret = c.env.UPLOAD_SECRET;
    const isAdmin = expectedSecret && providedKey === expectedSecret;

    if (!expectedSecret || !isAdmin) {
        return c.json({ success: false, error: 'Unauthorized: Admin secret key required' }, 401);
    }

    try {
        const result = await exportD1ToDrive(c.env);
        return c.json(result);
    } catch (err: any) {
        console.error('Drive backup failed:', err);
        return c.json({ success: false, error: err.message || 'Backup failed' }, 500);
    }
});

export default backupRoute;
