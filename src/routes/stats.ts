import { Hono } from 'hono';
import { getStorageStats } from '../db/queries';
import { Env } from '../types';

const statsRoute = new Hono<{ Bindings: Env }>();

function formatBytes(bytes: number, decimals: number = 2): string {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

statsRoute.get('/api/stats', async (c) => {
    const authHeader = c.req.header('Authorization');
    const apiKeyHeader = c.req.header('X-API-Key') || c.req.header('X-Auth-Key');
    const tokenQuery = c.req.query('key') || c.req.query('secret');

    let providedKey = apiKeyHeader || tokenQuery;
    if (!providedKey && authHeader) {
        if (authHeader.startsWith('Bearer ')) {
            providedKey = authHeader.slice(7).trim();
        } else {
            providedKey = authHeader.trim();
        }
    }

    const expectedSecret = c.env.UPLOAD_SECRET;
    const isAdmin = expectedSecret && providedKey === expectedSecret;

    if (!expectedSecret || !isAdmin) {
        return c.json({ success: false, error: 'Unauthorized: Admin secret key required' }, 401);
    }

    try {
        const rawStats = await getStorageStats(c.env.DB);
        const origin = new URL(c.req.url).origin;

        const formattedTopImages = rawStats.top_images.map(img => ({
            id: img.id,
            url: `${origin}/i/${img.id}`,
            views: img.views,
            size_formatted: formatBytes(img.size_bytes),
            created_at: new Date(img.created_at).toISOString()
        }));

        const driveSyncPercentage = rawStats.total_images > 0
            ? Math.round((rawStats.migrated_to_drive / rawStats.total_images) * 100)
            : 100;

        return c.json({
            success: true,
            storage: {
                total_images: rawStats.total_images,
                total_size_bytes: rawStats.total_size_bytes,
                total_size_formatted: formatBytes(rawStats.total_size_bytes),
                total_views: rawStats.total_views
            },
            google_drive_sync: {
                synced_images: rawStats.migrated_to_drive,
                pending_sync: rawStats.pending_drive_migration,
                sync_percentage: `${driveSyncPercentage}%`
            },
            top_viewed_images: formattedTopImages
        });
    } catch (err: any) {
        console.error('Stats query error:', err);
        return c.json({ success: false, error: err.message || 'Internal Server Error' }, 500);
    }
});

export default statsRoute;
