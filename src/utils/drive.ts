import { Env } from '../types';

// ponytail: module-level token cache, per-isolate; upgrade to KV/DO when multi-isolate thrash matters
let cachedToken: string | null = null;
let tokenExpiry = 0;

export function isDriveEnabled(env: Env): boolean {
    return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

export async function getAccessToken(env: Env): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID!,
            client_secret: env.GOOGLE_CLIENT_SECRET!,
            refresh_token: env.GOOGLE_REFRESH_TOKEN!,
            grant_type: 'refresh_token',
        }),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Drive token failed ${res.status}: ${txt}`);
    }
    const data = (await res.json()) as any;
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3500000);
    return cachedToken!;
}

export async function uploadToDrive(env: Env, buf: ArrayBuffer, name: string, mime: string): Promise<string> {
    const token = await getAccessToken(env);
    const boundary = 'imgof_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const metadata: any = { name };
    if (env.GOOGLE_FOLDER_ID) metadata.parents = [env.GOOGLE_FOLDER_ID];

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
        throw new Error(`Drive upload failed ${up.status}: ${txt}`);
    }
    const { id } = (await up.json()) as any;

    // make public — best-effort, serve still works via auth proxy even if this 403s
    try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
    } catch {}
    return id;
}

export async function fetchFromDrive(env: Env, fileId: string): Promise<Response | null> {
    const token = await getAccessToken(env);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res;
}

export async function deleteFromDrive(env: Env, fileId: string): Promise<void> {
    const token = await getAccessToken(env);
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
}
