/**
 * IP Access Rules Configuration (IPv4 & IPv6)
 */

// 1. DAFTAR IP ADMIN / ALLOWLIST (Kebal blokir & Selalu Diizinkan)
export const ALLOWED_IPS: Set<string> = new Set([
    '2404:c0:ca01:4d76:4ef8:dd79:e2d5:9d74', // IP Anda (Aman dari pemblokiran)
]);

// 2. DAFTAR IP PENYERANG / BLOCKLIST (Ditolak 403 Forbidden)
export const BLOCKED_IPS: Set<string> = new Set([
    '64.89.161.82',
    '107.173.160.145',
    '98.91.77.46',
]);
