const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateId(length: number = 6): string {
    let result = '';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        result += alphabet[randomValues[i] % alphabet.length];
    }
    return result;
}

export function generateDeleteToken(): string {
    return crypto.randomUUID().replace(/-/g, '');
}
