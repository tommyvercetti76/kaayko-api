const { stripJpeg, stripPng, stripWebp, stripImageMetadata } = require('../api/weather/imageSanitize');

function jpegWith(segments) {
  const parts = [Buffer.from([0xff, 0xd8])];
  segments.forEach(([marker, payload]) => {
    const len = Buffer.alloc(2); len.writeUInt16BE(payload.length + 2);
    parts.push(Buffer.from([0xff, marker]), len, payload);
  });
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.from('scan-data'), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

describe('image metadata stripping', () => {
  test('JPEG: drops EXIF (APP1) and comments, keeps JFIF and the scan', () => {
    const exif = Buffer.from('Exif\0\0GPS-LAT-HERE');
    const jfif = Buffer.from('JFIF\0');
    const buf = jpegWith([[0xe0, jfif], [0xe1, exif], [0xfe, Buffer.from('made by phone')]]);
    const out = stripJpeg(buf);
    expect(out.includes('GPS-LAT-HERE')).toBe(false);
    expect(out.includes('made by phone')).toBe(false);
    expect(out.includes('JFIF')).toBe(true);
    expect(out.includes('scan-data')).toBe(true);
    expect(out[0]).toBe(0xff); expect(out[1]).toBe(0xd8);
  });

  test('PNG: drops eXIf and tEXt chunks, keeps IHDR/IDAT/IEND', () => {
    function chunk(type, data) {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
    }
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const buf = Buffer.concat([sig, chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('Author\0Rohan')),
      chunk('eXIf', Buffer.from('GPSDATA')), chunk('IDAT', Buffer.from('pixels')), chunk('IEND', Buffer.alloc(0))]);
    const out = stripPng(buf);
    expect(out.includes('Rohan')).toBe(false);
    expect(out.includes('GPSDATA')).toBe(false);
    expect(out.includes('pixels')).toBe(true);
    expect(out.includes('IEND')).toBe(true);
  });

  test('WebP: drops EXIF/XMP chunks and fixes the RIFF size', () => {
    function chunk(type, data) {
      const len = Buffer.alloc(4); len.writeUInt32LE(data.length);
      const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
      return Buffer.concat([Buffer.from(type, 'latin1'), len, data, pad]);
    }
    const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04;
    const body = Buffer.concat([chunk('VP8X', vp8x), chunk('EXIF', Buffer.from('GPSDATA')), chunk('VP8 ', Buffer.from('pixels!')), chunk('XMP ', Buffer.from('<x:xmpmeta/>'))]);
    const header = Buffer.alloc(12); header.write('RIFF', 0); header.writeUInt32LE(4 + body.length, 4); header.write('WEBP', 8);
    const out = stripWebp(Buffer.concat([header, body]));
    expect(out.includes('GPSDATA')).toBe(false);
    expect(out.includes('xmpmeta')).toBe(false);
    expect(out.includes('pixels!')).toBe(true);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out[20] & 0x0c).toBe(0); // VP8X flags cleared
  });

  test('unknown or malformed input is returned unchanged', () => {
    const junk = Buffer.from('hello');
    expect(stripImageMetadata(junk, 'image/gif')).toBe(junk);
    expect(stripImageMetadata(junk, 'image/jpeg')).toBe(junk);
  });
});
