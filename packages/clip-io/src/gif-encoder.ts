/**
 * Minimal single-frame GIF89a encoder. GIF only supports a 256-color palette and 1-bit
 * (on/off) transparency, so this is inherently lossy for arbitrary RGBA input: colors are
 * quantized to a fixed 6x7x6 color cube (252 entries) plus one reserved transparent index, and
 * any pixel with alpha < 128 is treated as fully transparent (others as fully opaque).
 */

const R_LEVELS = 6;
const G_LEVELS = 7;
const B_LEVELS = 6;
const TRANSPARENT_INDEX = 0;

function quantizeIndex(r: number, g: number, b: number): number {
  const ri = Math.round((r / 255) * (R_LEVELS - 1));
  const gi = Math.round((g / 255) * (G_LEVELS - 1));
  const bi = Math.round((b / 255) * (B_LEVELS - 1));
  return 1 + ri * G_LEVELS * B_LEVELS + gi * B_LEVELS + bi;
}

function buildPalette(): Uint8Array {
  // 256 entries * 3 bytes; index 0 is the (unused, arbitrary) transparent color slot.
  const palette = new Uint8Array(256 * 3);
  for (let ri = 0; ri < R_LEVELS; ri++) {
    for (let gi = 0; gi < G_LEVELS; gi++) {
      for (let bi = 0; bi < B_LEVELS; bi++) {
        const index = 1 + ri * G_LEVELS * B_LEVELS + gi * B_LEVELS + bi;
        palette[index * 3] = Math.round((ri / (R_LEVELS - 1)) * 255);
        palette[index * 3 + 1] = Math.round((gi / (G_LEVELS - 1)) * 255);
        palette[index * 3 + 2] = Math.round((bi / (B_LEVELS - 1)) * 255);
      }
    }
  }
  return palette;
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const bytes: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict: Map<string, number> = new Map();

  function resetDict(): void {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i);
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  }

  function emit(code: number): void {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  resetDict();
  emit(clearCode);

  if (indices.length === 0) {
    emit(endCode);
  } else {
    let w = String.fromCharCode(indices[0]);
    for (let i = 1; i < indices.length; i++) {
      const c = String.fromCharCode(indices[i]);
      const wc = w + c;
      if (dict.has(wc)) {
        w = wc;
        continue;
      }
      emit(dict.get(w)!);
      if (nextCode < 4096) {
        dict.set(wc, nextCode++);
        if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        resetDict();
      }
      w = c;
    }
    emit(dict.get(w)!);
    emit(endCode);
  }

  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return new Uint8Array(bytes);
}

export function encodeGif(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    indices[i] = pixels[p + 3] < 128 ? TRANSPARENT_INDEX : quantizeIndex(pixels[p], pixels[p + 1], pixels[p + 2]);
  }

  const palette = buildPalette();
  const minCodeSize = 8; // 256-color global table
  const lzwData = lzwEncode(indices, minCodeSize);

  const chunks: number[] = [];
  const push = (...bytes: number[]) => chunks.push(...bytes);
  const pushU16 = (v: number) => push(v & 0xff, (v >> 8) & 0xff);

  // Header
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
  // Logical Screen Descriptor
  pushU16(width);
  pushU16(height);
  push(0xf7); // global color table flag=1, color resolution=7, sort=0, size=7 (2^(7+1)=256)
  push(0); // background color index
  push(0); // pixel aspect ratio
  // Global Color Table (256 * 3 bytes)
  for (const b of palette) push(b);
  // Graphic Control Extension (transparency)
  push(0x21, 0xf9, 0x04);
  push(0x01); // transparent color flag
  pushU16(0); // delay time
  push(TRANSPARENT_INDEX);
  push(0x00); // block terminator
  // Image Descriptor
  push(0x2c);
  pushU16(0);
  pushU16(0);
  pushU16(width);
  pushU16(height);
  push(0x00); // no local color table
  // Image Data
  push(minCodeSize);
  for (let i = 0; i < lzwData.length; i += 255) {
    const slice = lzwData.subarray(i, Math.min(i + 255, lzwData.length));
    push(slice.length, ...slice);
  }
  push(0x00); // block terminator
  // Trailer
  push(0x3b);

  return new Uint8Array(chunks);
}
