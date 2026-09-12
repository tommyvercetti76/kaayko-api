// functions/api/weather/imageSanitize.js
//
// Strips metadata (EXIF / XMP / ICC-adjacent text chunks) from user-uploaded
// photos before they are stored publicly. Community photos come straight off a
// phone and carry GPS fixes, device model, capture time and sometimes the
// owner's name — none of which should be publicly addressable on our bucket.
//
// Pure JS, no native deps (sharp is not in this bundle). Each format is handled
// by walking its container structure and dropping the metadata segments;
// pixel data is never touched, so the image itself is byte-for-byte the same.
// Anything that fails to parse is returned unchanged — the magic-byte check
// upstream already guarantees the container type, and refusing a photo over a
// metadata quirk would be the wrong failure mode.

const JPEG_KEEP_APP = new Set([0xe0, 0xee]); // APP0 (JFIF), APP14 (Adobe colour transform)

function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out = [buf.subarray(0, 2)];
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return buf; // not a marker — bail, keep original
    const marker = buf[pos + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (marker === 0xda) {
      // Start of scan: everything from here to EOI is entropy-coded pixel data.
      out.push(buf.subarray(pos));
      return Buffer.concat(out);
    }
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) return buf;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    const drop = (isApp && !JPEG_KEEP_APP.has(marker)) || isComment;
    if (!drop) out.push(buf.subarray(pos, pos + 2 + len));
    pos += 2 + len;
  }
  return buf;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return buf;
  const out = [buf.subarray(0, 8)];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1');
    const end = pos + 12 + len;
    if (end > buf.length) return buf;
    if (!PNG_DROP.has(type)) out.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

const WEBP_DROP = new Set(['EXIF', 'XMP ']);

function stripWebp(buf) {
  if (buf.length < 12 || buf.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      buf.subarray(8, 12).toString('ascii') !== 'WEBP') return buf;
  const chunks = [];
  let pos = 12;
  let changed = false;
  while (pos + 8 <= buf.length) {
    const type = buf.subarray(pos, pos + 4).toString('latin1');
    const len = buf.readUInt32LE(pos + 4);
    const padded = len + (len % 2);
    const end = pos + 8 + padded;
    if (end > buf.length) return buf;
    if (WEBP_DROP.has(type)) changed = true;
    else chunks.push(buf.subarray(pos, end));
    pos = end;
  }
  if (!changed) return buf;
  // VP8X carries flags advertising EXIF/XMP presence; clear them so decoders
  // don't go looking for chunks that are no longer there.
  const body = Buffer.concat(chunks);
  if (body.subarray(0, 4).toString('latin1') === 'VP8X' && body.length >= 12) {
    body[8] = body[8] & ~0x08 & ~0x04; // bit3 = EXIF, bit2 = XMP
  }
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/**
 * Remove metadata from a JPEG / PNG / WebP buffer. Returns the original buffer
 * for unknown types or on any structural surprise.
 */
function stripImageMetadata(buffer, mime) {
  try {
    if (mime === 'image/jpeg') return stripJpeg(buffer);
    if (mime === 'image/png') return stripPng(buffer);
    if (mime === 'image/webp') return stripWebp(buffer);
  } catch (err) {
    // fall through — never block an upload on a metadata parse error
  }
  return buffer;
}

module.exports = { stripImageMetadata, stripJpeg, stripPng, stripWebp };
