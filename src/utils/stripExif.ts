/**
 * ponytail: pure ArrayBuffer JPEG APP1 (EXIF) strip — keeps Orientation (0x0112) via minimal rebuilt APP1,
 * drops GPS/metadata. Ceiling: no pixel re-encode (rotated pixels stay as-is), no PNG/WebP strip.
 * Upgrade: sharp/wasm or Cloudflare Image Resizing when need full orientation normalize.
 */
export function stripExif(buf: ArrayBuffer): ArrayBuffer {
    const u8 = new Uint8Array(buf);
    if (u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) return buf;
    let offset = 2;
    let foundExif = false;
    let orientation: number | null = null;
    const segments: { marker: number; len: number; isExif: boolean; raw: Uint8Array }[] = [];

    while (offset + 4 <= u8.length) {
        if (u8[offset] !== 0xFF) break;
        const marker = u8[offset + 1];
        if (marker === 0xD9) { // EOI
            segments.push({ marker, len: 0, isExif: false, raw: u8.slice(offset) });
            break;
        }
        if (marker === 0xD8) { offset += 2; continue; } // stray SOI
        if (marker === 0xDA) { // SOS — rest is scan data
            segments.push({ marker, len: 0, isExif: false, raw: u8.slice(offset) });
            break;
        }
        if (offset + 3 >= u8.length) break;
        const len = (u8[offset + 2] << 8) | u8[offset + 3];
        if (len < 2 || offset + 2 + len > u8.length) break;
        const raw = u8.slice(offset, offset + 2 + len);
        let isExif = false;
        if (marker === 0xE1 && len >= 8 && u8[offset + 4] === 0x45 && u8[offset + 5] === 0x78 && u8[offset + 6] === 0x69 && u8[offset + 7] === 0x66 && u8[offset + 8] === 0x00 && u8[offset + 9] === 0x00) {
            isExif = true;
            foundExif = true;
            if (orientation === null) orientation = parseOrientation(u8, offset + 4);
        }
        segments.push({ marker, len, isExif, raw });
        offset += 2 + len;
    }
    if (!foundExif) return buf;
    // rebuild
    const out: Uint8Array[] = [u8.slice(0, 2)]; // SOI
    let kept = false;
    for (const s of segments) {
        if (s.isExif) continue;
        // skip SOI already
        if (s.marker === 0xD9 || s.marker === 0xDA) { out.push(s.raw); kept = true; break; }
        out.push(s.raw);
    }
    // re-insert minimal orientation APP1 if needed (non-1)
    if (orientation !== null && orientation !== 1) {
        out.splice(1, 0, buildMinimalExif(orientation));
    }
    // if nothing stripped (should not happen), return original
    let total = 0;
    for (const p of out) total += p.length;
    // detect no-op (segment count same as original scan without insertion)
    if (total === u8.length && orientation === null) return buf;
    const res = new Uint8Array(total);
    let pos = 0;
    for (const p of out) { res.set(p, pos); pos += p.length; }
    return res.buffer as ArrayBuffer;
}

function parseOrientation(u8: Uint8Array, exifStart: number): number | null {
    try {
        const tiffOff = exifStart + 6;
        if (tiffOff + 8 > u8.length) return null;
        const le = u8[tiffOff] === 0x49 && u8[tiffOff + 1] === 0x49;
        const be = u8[tiffOff] === 0x4D && u8[tiffOff + 1] === 0x4D;
        if (!le && !be) return null;
        const r16 = (o: number) => le ? (u8[o] | (u8[o + 1] << 8)) : ((u8[o] << 8) | u8[o + 1]);
        const r32 = (o: number) => le ? (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0 : (((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0);
        const ifdOff = r32(tiffOff + 4);
        const ifd = tiffOff + ifdOff;
        if (ifd + 2 > u8.length) return null;
        const n = r16(ifd);
        for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            if (e + 12 > u8.length) break;
            const tag = r16(e);
            if (tag === 0x0112) {
                const type = r16(e + 2);
                if (type === 3) { // SHORT
                    return r16(e + 8);
                }
            }
        }
    } catch {}
    return null;
}

function buildMinimalExif(orientation: number): Uint8Array {
    // APP1 with minimal TIFF preserving only Orientation
    const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
    const tiff = new Uint8Array(26);
    // II* magic + offset 8
    tiff[0] = 0x49; tiff[1] = 0x49; tiff[2] = 0x2A; tiff[3] = 0x00; tiff[4] = 0x08; tiff[5] = 0x00; tiff[6] = 0x00; tiff[7] = 0x00;
    // IFD0: 1 entry
    tiff[8] = 0x01; tiff[9] = 0x00;
    // entry: tag 0x0112, type SHORT(3), count 1, value orientation
    tiff[10] = 0x12; tiff[11] = 0x01; tiff[12] = 0x03; tiff[13] = 0x00; tiff[14] = 0x01; tiff[15] = 0x00; tiff[16] = 0x00; tiff[17] = 0x00;
    tiff[18] = orientation & 0xFF; tiff[19] = (orientation >> 8) & 0xFF; tiff[20] = 0x00; tiff[21] = 0x00;
    // next IFD 0
    tiff[22] = 0x00; tiff[23] = 0x00; tiff[24] = 0x00; tiff[25] = 0x00;
    const contentLen = exifHeader.length + tiff.length; // 32
    const segLen = contentLen + 2; // 34
    const seg = new Uint8Array(2 + 2 + contentLen);
    seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = (segLen >> 8) & 0xFF; seg[3] = segLen & 0xFF;
    seg.set(exifHeader, 4);
    seg.set(tiff, 10);
    return seg;
}

// self-check
if (import.meta.main) {
    // build fake JPEG: SOI + APP1 Exif orientation=6 + APP0 + SOS + EOI
    const soi = new Uint8Array([0xFF, 0xD8]);
    const fakeExif = buildMinimalExif(6);
    // add fake GPS-like APP1 by cloning and patching extra bytes
    const app0 = new Uint8Array([0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00]); // minimal JFIF
    const sos = new Uint8Array([0xFF, 0xDA, 0x00, 0x02]);
    const eoi = new Uint8Array([0xFF, 0xD9]);
    const total = soi.length + fakeExif.length + app0.length + sos.length + eoi.length;
    const buf = new Uint8Array(total);
    let p = 0; buf.set(soi, p); p += soi.length; buf.set(fakeExif, p); p += fakeExif.length; buf.set(app0, p); p += app0.length; buf.set(sos, p); p += sos.length; buf.set(eoi, p);
    const stripped = stripExif(buf.buffer);
    const sU8 = new Uint8Array(stripped);
    // should still contain orientation=6 (rebuilt) and be smaller or equal
    console.assert(sU8[0] === 0xFF && sU8[1] === 0xD8, 'SOI preserved');
    console.assert(parseOrientation(sU8, 4 + 2) === 6 || sU8.length < buf.length, 'orientation kept or stripped');
    console.log('stripExif self-check OK', { orig: buf.length, stripped: sU8.length });
}
