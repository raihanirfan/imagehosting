/**
 * Binary magic bytes detector for uploaded files
 * Ensures true MIME validation and prevents arbitrary file upload vulnerabilities.
 */

export function detectMimeTypeFromBuffer(buffer: ArrayBuffer): string | null {
    if (!buffer || buffer.byteLength < 4) return null;

    const bytes = new Uint8Array(buffer.slice(0, 64));

    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4E &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0D &&
        bytes[5] === 0x0A &&
        bytes[6] === 0x1A &&
        bytes[7] === 0x0A
    ) {
        return 'image/png';
    }

    // GIF: GIF87a (47 49 46 38 37 61) or GIF89a (47 49 46 38 39 61)
    if (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
    ) {
        return 'image/gif';
    }

    // WebP: RIFF [4 bytes size] WEBP
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50   // WEBP
    ) {
        return 'image/webp';
    }

    // SVG: Text XML containing <svg
    try {
        const textSample = new TextDecoder().decode(bytes).trim().toLowerCase();
        if (textSample.startsWith('<?xml') || textSample.startsWith('<svg') || textSample.includes('<svg')) {
            return 'image/svg+xml';
        }
    } catch {}

    return null;
}
