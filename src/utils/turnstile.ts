interface TurnstileVerifyResponse {
    success: boolean;
    'error-codes'?: string[];
    challenge_ts?: string;
    hostname?: string;
}

export async function verifyTurnstile(
    secretKey: string, 
    token: string, 
    remoteIp?: string
): Promise<boolean> {
    if (!token || !secretKey) return false;

    const formData = new FormData();
    formData.append('secret', secretKey.trim());
    formData.append('response', token.trim());
    if (remoteIp && remoteIp !== 'anonymous' && remoteIp !== 'authenticated' && (remoteIp.includes('.') || remoteIp.includes(':'))) {
        formData.append('remoteip', remoteIp);
    }

    const url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    try {
        const result = await fetch(url, {
            body: formData,
            method: 'POST',
        });

        if (!result.ok) {
            console.error('Turnstile HTTP status:', result.status);
            return false;
        }

        const outcome = (await result.json()) as TurnstileVerifyResponse;
        if (!outcome.success) {
            console.error('Turnstile rejection:', JSON.stringify(outcome));
        }
        return Boolean(outcome.success);
    } catch (err) {
        console.error('Turnstile verification error:', err);
        return false;
    }
}