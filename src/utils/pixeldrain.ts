/**
 * Pixeldrain Storage Adapter
 * API Docs: https://pixeldrain.com/api
 */

export interface PixeldrainUploadResult {
    success: boolean;
    id: string;
    url: string;
}

export async function uploadToPixeldrain(
    buffer: ArrayBuffer,
    fileName: string,
    apiKey?: string
): Promise<PixeldrainUploadResult> {
    const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    };
    if (apiKey) {
        // HTTP Basic Auth with api_key as password
        const auth = btoa(`:${apiKey}`);
        headers['Authorization'] = `Basic ${auth}`;
    }

    const safeName = encodeURIComponent(fileName || 'image.png');
    const uploadUrl = `https://pixeldrain.com/api/file/${safeName}`;

    const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: buffer
    });

    if (!res.ok) {
        throw new Error(`Pixeldrain upload failed: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    if (!data.success && !data.id) {
        throw new Error(data.message || 'Unknown Pixeldrain error');
    }

    const fileId = data.id;
    return {
        success: true,
        id: fileId,
        url: `https://pixeldrain.com/api/file/${fileId}`
    };
}

export async function fetchFromPixeldrain(fileId: string, apiKey?: string): Promise<Response | null> {
    try {
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        };
        if (apiKey) {
            headers['Authorization'] = `Basic ${btoa(`:${apiKey}`)}`;
        }
        const res = await fetch(`https://pixeldrain.com/api/file/${fileId}`, { headers });
        if (res.ok) return res;
        return null;
    } catch {
        return null;
    }
}

export async function deleteFromPixeldrain(fileId: string, apiKey?: string): Promise<boolean> {
    try {
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        };
        if (apiKey) {
            headers['Authorization'] = `Basic ${btoa(`:${apiKey}`)}`;
        }
        const res = await fetch(`https://pixeldrain.com/api/file/${fileId}`, {
            method: 'DELETE',
            headers
        });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Sends a dynamic range GET request to reset Pixeldrain's inactivity timer.
 * Dynamically requests at least 64 KB or 12% of the file size to always satisfy the 10% threshold.
 */
export async function pingPixeldrain(fileId: string, sizeBytes?: number): Promise<boolean> {
    try {
        const bytesToRead = sizeBytes && sizeBytes > 0
            ? Math.max(65536, Math.ceil(sizeBytes * 0.12))
            : 65536;

        const res = await fetch(`https://pixeldrain.com/api/file/${fileId}`, {
            method: 'GET',
            headers: {
                'Range': `bytes=0-${bytesToRead - 1}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            }
        });
        // Consume the tiny chunk to ensure connection closes cleanly
        if (res.body) {
            await res.arrayBuffer().catch(() => {});
        }
        return res.ok || res.status === 206;
    } catch {
        return false;
    }
}
