import { Env, ImageRecord } from '../types';

export async function getImageById(db: D1Database, id: string): Promise<ImageRecord | null> {
    return await db.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<ImageRecord>();
}

export async function getImageByHash(db: D1Database, hash: string): Promise<ImageRecord | null> {
    return await db.prepare('SELECT * FROM images WHERE hash = ?').bind(hash).first<ImageRecord>();
}

export async function createImage(db: D1Database, record: ImageRecord): Promise<void> {
    await db.prepare(
        'INSERT INTO images (id, hash, original_name, mime_type, size_bytes, delete_token, created_at, drive_file_id, uploader_ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
        record.uploader_ip || null
    )
    .run();
}

export async function incrementViewCount(db: D1Database, id: string): Promise<void> {
    await db.prepare('UPDATE images SET views = views + 1 WHERE id = ?').bind(id).run();
}

export async function deleteImageRecord(db: D1Database, id: string): Promise<void> {
    await db.prepare('DELETE FROM images WHERE id = ?').bind(id).run();
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

