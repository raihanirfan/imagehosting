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
