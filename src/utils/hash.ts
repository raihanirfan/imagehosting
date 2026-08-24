export async function calculateHash(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashIp(ip: string, salt: string = 'imgof_salt_2026'): Promise<string> {
    if (!ip) return 'anonymous';
    const encoder = new TextEncoder();
    const data = encoder.encode(`${ip}:${salt}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Return 32-char truncated salted hash for anonymous tracking
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

// ponytail: AES-GCM 256 with SHA-256(salt) as key; 12B random IV prepended, base64(iv+ciphertext)
async function getAesKey(salt: string): Promise<CryptoKey> {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt));
    return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptIp(ip: string, salt: string): Promise<string> {
    if (!ip) return '';
    const key = await getAesKey(salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(ip));
    const c = new Uint8Array(iv.length + ct.byteLength);
    c.set(iv, 0); c.set(new Uint8Array(ct), iv.length);
    let bin = ''; c.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
}
export async function decryptIp(enc: string, salt: string): Promise<string> {
    const key = await getAesKey(salt);
    const raw = atob(enc); const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    const iv = buf.slice(0, 12); const ct = buf.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
}
