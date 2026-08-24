import { Env, ImageRecord } from '../types';

export async function getImageById(db: D1Database, id: string): Promise<ImageRecord | null> {
    return await db.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<ImageRecord>();
}

export async function getImageByHash(db: D1Database, hash: string): Promise<ImageRecord | null> {
    return await db.prepare('SELECT * FROM images WHERE hash = ?').bind(hash).first<ImageRecord>();
}

export async function createImage(db: D1Database, record: ImageRecord): Promise<void> {
    await db.prepare(
        'INSERT INTO images (id, hash, original_name, mime_type, size_bytes, delete_token, created_at, drive_file_id, pixeldrain_id, buzzheavier_id, uploader_ip, uploader_ip_enc, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
        record.id,
        record.hash,
        record.original_name,
        record.mime_type,
        record.size_bytes,
        record.delete_token,
        record.created_at,
        record.drive_file_id || null,
        record.pixeldrain_id || null,
        record.buzzheavier_id || null,
        record.uploader_ip || null,
        record.uploader_ip_enc || null,
        (record as any).expires_at ?? null
    )
    .run();
}

export async function incrementViewCount(db: D1Database, id: string): Promise<void> {
    await db.prepare('UPDATE images SET views = views + 1 WHERE id = ?').bind(id).run();
}

export async function deleteImageRecord(db: D1Database, id: string): Promise<void> {
    await db.prepare('DELETE FROM images WHERE id = ?').bind(id).run();
}

export async function lockImage(db: D1Database, id: string, reason?: string): Promise<void> {
    try {
        await db.prepare('UPDATE images SET locked_at = ?, locked_reason = ? WHERE id = ?').bind(Date.now(), reason || null, id).run();
    } catch (e: any) {
        if (String(e?.message || e).includes('no such column')) {
            // ponytail: auto-migrate on first lock if column missing; upgrade to wrangler migrations if schema grows
            await db.prepare('ALTER TABLE images ADD COLUMN locked_at INTEGER').run().catch(() => {});
            await db.prepare('ALTER TABLE images ADD COLUMN locked_reason TEXT').run().catch(() => {});
            await db.prepare('UPDATE images SET locked_at = ?, locked_reason = ? WHERE id = ?').bind(Date.now(), reason || null, id).run();
        } else throw e;
    }
}
export async function unlockImage(db: D1Database, id: string): Promise<void> {
    try {
        await db.prepare('UPDATE images SET locked_at = NULL, locked_reason = NULL WHERE id = ?').bind(id).run();
    } catch (e: any) {
        if (String(e?.message || e).includes('no such column')) {
            await db.prepare('ALTER TABLE images ADD COLUMN locked_at INTEGER').run().catch(() => {});
            await db.prepare('ALTER TABLE images ADD COLUMN locked_reason TEXT').run().catch(() => {});
            await db.prepare('UPDATE images SET locked_at = NULL, locked_reason = NULL WHERE id = ?').bind(id).run();
        } else throw e;
    }
}

export interface StorageStats {
    total_images: number;
    total_size_bytes: number;
    total_views: number;
    migrated_to_drive: number;
    pending_drive_migration: number;
    top_images: Array<{ id: string; views: number; size_bytes: number; created_at: number }>;
}

export async function getStorageStats(db: D1Database): Promise<StorageStats> {
    const summary = await db.prepare(`
        SELECT 
            COUNT(*) as total_images,
            COALESCE(SUM(size_bytes), 0) as total_size_bytes,
            COALESCE(SUM(views), 0) as total_views,
            COALESCE(SUM(CASE WHEN drive_file_id IS NOT NULL THEN 1 ELSE 0 END), 0) as migrated_to_drive,
            COALESCE(SUM(CASE WHEN drive_file_id IS NULL THEN 1 ELSE 0 END), 0) as pending_drive_migration
        FROM images
    `).first<{
        total_images: number;
        total_size_bytes: number;
        total_views: number;
        migrated_to_drive: number;
        pending_drive_migration: number;
    }>();

    const topImages = await db.prepare(`
        SELECT id, views, size_bytes, created_at 
        FROM images 
        ORDER BY views DESC 
        LIMIT 10
    `).all<{ id: string; views: number; size_bytes: number; created_at: number }>();

    return {
        total_images: summary?.total_images || 0,
        total_size_bytes: summary?.total_size_bytes || 0,
        total_views: summary?.total_views || 0,
        migrated_to_drive: summary?.migrated_to_drive || 0,
        pending_drive_migration: summary?.pending_drive_migration || 0,
        top_images: topImages.results || []
    };
}

export async function getPublicStats(db: D1Database): Promise<{
    uploads_per_day: Array<{ day: string; count: number }>;
    storage_per_day: Array<{ day: string; gb: number }>;
    by_type: Array<{ mime: string; count: number }>;
    by_size: Array<{ bucket: string; count: number }>;
}> {
    const perDay = await db.prepare(`
        SELECT substr(datetime(created_at/1000,'unixepoch'),1,10) as day,
               COUNT(*) as count, COALESCE(SUM(size_bytes),0) as bytes
        FROM images GROUP BY day ORDER BY day DESC LIMIT 30
    `).all<{day:string;count:number;bytes:number}>();
    const rows = (perDay.results || []).reverse();
    const byType = await db.prepare(`SELECT mime_type as mime, COUNT(*) as count FROM images GROUP BY mime_type ORDER BY count DESC`).all<{mime:string;count:number}>();
    const bySize = await db.prepare(`
        SELECT CASE WHEN size_bytes<1048576 THEN '<1MB' WHEN size_bytes<5242880 THEN '1-5MB' WHEN size_bytes<10485760 THEN '5-10MB' ELSE '>10MB' END as bucket, COUNT(*) as count
        FROM images GROUP BY bucket
    `).all<{bucket:string;count:number}>();
    return {
        uploads_per_day: rows.map(r=>({day:r.day,count:r.count})),
        storage_per_day: rows.map(r=>({day:r.day,gb:+(r.bytes/1073741824).toFixed(3)})),
        by_type: byType.results || [],
        by_size: bySize.results || [],
    };
}

