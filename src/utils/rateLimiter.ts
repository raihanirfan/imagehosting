interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * In-memory sliding window rate limiter
 * @param key Identifier (e.g. Client IP address)
 * @param limit Maximum allowed requests within the window
 * @param windowMs Time window in milliseconds (default: 60,000ms = 1 minute)
 */
export function checkRateLimit(
    key: string,
    limit: number = 30,
    windowMs: number = 60000
): { allowed: boolean; remaining: number; resetInSec: number } {
    const now = Date.now();

    // Memory cleanup: remove expired records if store grows large
    if (rateLimitStore.size > 2000) {
        for (const [k, entry] of rateLimitStore.entries()) {
            if (now > entry.resetAt) {
                rateLimitStore.delete(k);
            }
        }
    }

    const record = rateLimitStore.get(key);

    if (!record || now > record.resetAt) {
        rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
        return {
            allowed: true,
            remaining: limit - 1,
            resetInSec: Math.ceil(windowMs / 1000)
        };
    }

    if (record.count >= limit) {
        const resetInSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
        return {
            allowed: false,
            remaining: 0,
            resetInSec
        };
    }

    record.count += 1;
    const resetInSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return {
        allowed: true,
        remaining: limit - record.count,
        resetInSec
    };
}
