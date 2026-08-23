/**
 * Buzzheavier Storage Adapter
 * API: https://w.buzzheavier.com/{filename}
 */

export interface BuzzheavierUploadResult {
    success: boolean;
    id: string;
    url: string;
}

export async function uploadToBuzzheavier(
    buffer: ArrayBuffer,
    fileName: string,
    accountId?: string
): Promise<BuzzheavierUploadResult> {
    const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    };
    if (accountId) {
        headers['Authorization'] = `Bearer ${accountId}`;
    }

    const safeName = encodeURIComponent(fileName || 'image.png');
    const uploadUrl = `https://w.buzzheavier.com/${safeName}`;

    const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: buffer
    });

    if (!res.ok) {
        throw new Error(`Buzzheavier upload failed: ${res.status} ${res.statusText}`);
    }

    const json: any = await res.json();
    const fileData = json.data || json;
    const fileId = fileData.id || fileData.key || safeName;
    return {
        success: true,
        id: fileId,
        url: `https://buzzheavier.com/${fileId}`
    };
}

export async function fetchFromBuzzheavier(fileId: string, accountId?: string): Promise<Response | null> {
    try {
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        };
        if (accountId) {
            headers['Authorization'] = `Bearer ${accountId}`;
        }
        const res = await fetch(`https://w.buzzheavier.com/${fileId}`, { headers });
        if (res.ok) return res;
        return null;
    } catch {
        return null;
    }
}

/**
 * Sends a lightweight 1-byte GET request (Range: bytes=0-0).
 * Registers as 1 download on Buzzheavier (+3 days retention) while transferring only 1 byte.
 */
export async function pingBuzzheavier(fileId: string): Promise<boolean> {
    try {
        const res = await fetch(`https://w.buzzheavier.com/${fileId}`, {
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
