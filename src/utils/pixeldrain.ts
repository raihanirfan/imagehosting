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

/**
 * Sends a lightweight 1-byte GET request or info check to reset Pixeldrain's 60-day inactivity timer.
 */
export async function pingPixeldrain(fileId: string): Promise<boolean> {
    try {
        const res = await fetch(`https://pixeldrain.com/api/file/${fileId}`, {
            method: 'GET',
            headers: {
                'Range': 'bytes=0-0',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            }
        });
        return res.ok || res.status === 206;
    } catch {
        return false;
    }
}
