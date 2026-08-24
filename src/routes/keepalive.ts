import { Hono } from 'hono';
import { pingPixeldrain } from '../utils/pixeldrain';
import { pingBuzzheavier } from '../utils/buzzheavier';
import { Env } from '../types';

const keepaliveRoute = new Hono<{ Bindings: Env }>();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runKeepaliveJob(db: D1Database): Promise<{
    pixeldrain_pinged: number;
    buzzheavier_pinged: number;
}> {
    let pixeldrainPinged = 0;
    let buzzheavierPinged = 0;

    try {
        // Query images that have Pixeldrain or Buzzheavier storage IDs
        const records = await db.prepare(`
            SELECT id, pixeldrain_id, buzzheavier_id, size_bytes 
            FROM images 
            WHERE pixeldrain_id IS NOT NULL OR buzzheavier_id IS NOT NULL
            LIMIT 200
        `).all<{ id: string; pixeldrain_id: string | null; buzzheavier_id: string | null; size_bytes: number }>();

        const items = records.results || [];
        for (const item of items) {
            if (item.pixeldrain_id) {
                await pingPixeldrain(item.pixeldrain_id, item.size_bytes);
                pixeldrainPinged++;
                await sleep(150); // Polite 150ms throttle delay
            }
            if (item.buzzheavier_id) {
                await pingBuzzheavier(item.buzzheavier_id);
                buzzheavierPinged++;
                await sleep(150); // Polite 150ms throttle delay
            }
        }
    } catch (e) {
        console.error('Keepalive job error:', e);
    }

    return {
        pixeldrain_pinged: pixeldrainPinged,
        buzzheavier_pinged: buzzheavierPinged
    };
}

// Manual trigger endpoint for admin — header only
keepaliveRoute.post('/api/keepalive', async (c) => {
    const hdr = c.req.header('Authorization') || c.req.header('X-API-Key') || c.req.header('X-Auth-Key') || '';
    const providedKey = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : hdr.trim() || '';

    const expectedSecret = c.env.UPLOAD_SECRET;
    if (!expectedSecret || providedKey !== expectedSecret) {
        return c.json({ success: false, error: 'Unauthorized: Admin secret key required' }, 401);
    }

    const result = await runKeepaliveJob(c.env.DB);
    return c.json({
        success: true,
        message: 'Storage keep-alive ping routine completed successfully',
        data: result
    });
});

export default keepaliveRoute;
