/** Uncompressed 24-bit BMP (no alpha channel support in this classic variant; transparent pixels
 * are composited onto `background` first, same tradeoff as JPEG). */
export function encodeBmp(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  background: [number, number, number] = [255, 255, 255]
): Uint8Array {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);

  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true); // pixel data offset

  view.setUint32(14, 40, true); // BITMAPINFOHEADER size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive height = bottom-up row order
  view.setUint16(26, 1, true); // color planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(30, 0, true); // BI_RGB, no compression
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true); // ~72 DPI
  view.setInt32(42, 2835, true);

  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const a = pixels[srcIdx + 3] / 255;
      buf[offset++] = pixels[srcIdx + 2] * a + background[2] * (1 - a); // B
      buf[offset++] = pixels[srcIdx + 1] * a + background[1] * (1 - a); // G
      buf[offset++] = pixels[srcIdx] * a + background[0] * (1 - a); // R
    }
    offset += rowSize - width * 3; // row padding to a 4-byte boundary
  }
  return buf;
}
