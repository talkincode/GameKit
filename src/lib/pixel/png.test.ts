/**
 * PNG in and out of a pixel buffer. The encoder is checked against Node's own
 * zlib and CRC (not the code under test), and the decoder is fed hand-built files
 * in every layout a pygame asset is likely to have.
 */
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createPixels, pixelsEqual, type Pixels, type Rgba } from "./buffer";
import { decodePng, encodePng } from "./png";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

type Chunk = { type: string; data: Uint8Array; crc: number };

function chunksOf(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length), crc: view.getUint32(at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function chunk(type: string, data: number[] | Uint8Array): number[] {
  const body = [...type].map((char) => char.charCodeAt(0)).concat([...data]);
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}

/** A picture with every kind of pixel: opaque, transparent, semi-transparent, hidden colour under alpha 0. */
function sample(): Pixels {
  const pixels = createPixels(5, 3);
  const colours: Rgba[] = [
    [255, 0, 0, 255],
    [0, 0, 0, 0],
    [10, 20, 30, 77],
    [255, 0, 255, 0],
    [1, 2, 3, 254],
  ];
  for (let index = 0; index < 15; index += 1) pixels.data.set(colours[index % colours.length], index * 4);
  return pixels;
}

describe("encodePng", () => {
  it("writes a real PNG: signature, header, one data chunk, an end chunk, valid CRCs", () => {
    const png = encodePng(sample());
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
    const chunks = chunksOf(png);
    expect(chunks.map((item) => item.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    for (const item of chunks) {
      expect(item.crc).toBe(crc32(Uint8Array.from([...item.type].map((char) => char.charCodeAt(0)).concat([...item.data]))));
    }
    const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([5, 3]);
    // 8-bit, RGBA, deflate, adaptive filtering, not interlaced.
    expect([...chunks[0].data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  });

  it("stores exactly the pixels it was given, so alpha is kept and colours are not touched", () => {
    const pixels = sample();
    const idat = chunksOf(encodePng(pixels)).find((item) => item.type === "IDAT") as Chunk;
    const raw = inflateSync(idat.data);
    expect(raw.length).toBe((5 * 4 + 1) * 3);
    for (let y = 0; y < 3; y += 1) {
      const row = raw.subarray(y * 21, (y + 1) * 21);
      expect(row[0]).toBe(0);
      expect([...row.subarray(1)]).toEqual([...pixels.data.subarray(y * 20, (y + 1) * 20)]);
    }
  });

  it("is deterministic: the same picture always gives the same bytes", () => {
    expect(encodePng(sample())).toEqual(encodePng(sample()));
  });

  it("handles a 1×1 picture and a 256×256 picture", () => {
    expect(decodePng(encodePng(createPixels(1, 1, [9, 8, 7, 255])))).toEqual({
      ok: true,
      pixels: createPixels(1, 1, [9, 8, 7, 255]),
    });
    const big = createPixels(256, 256, [1, 2, 3, 255]);
    const result = decodePng(encodePng(big));
    expect(result.ok && pixelsEqual(result.pixels, big)).toBe(true);
  });
});

describe("round trip", () => {
  it("decodes what it encoded, byte for byte, including semi-transparent and hidden colours", () => {
    const pixels = sample();
    const result = decodePng(encodePng(pixels));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pixels.width).toBe(5);
    expect(result.pixels.height).toBe(3);
    expect([...result.pixels.data]).toEqual([...pixels.data]);
  });

  it("survives a pseudo-random picture of every alpha", () => {
    const pixels = createPixels(37, 29);
    let seed = 12345;
    for (let index = 0; index < pixels.data.length; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pixels.data[index] = seed >> 8;
    }
    const result = decodePng(encodePng(pixels));
    expect(result.ok && pixelsEqual(result.pixels, pixels)).toBe(true);
  });
});

/** Builds a PNG from raw scanlines, applying one filter type per row. */
function build(options: {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  rows: number[][];
  filters?: number[];
  palette?: number[];
  transparency?: number[];
  interlace?: number;
}): Uint8Array {
  const { width, height, colorType, bitDepth, rows } = options;
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] as number;
  const bpp = Math.max(1, (samples * bitDepth) / 8);
  const raw: number[] = [];
  rows.forEach((row, y) => {
    const filter = options.filters?.[y] ?? 0;
    const prior = y ? rows[y - 1] : row.map(() => 0);
    raw.push(filter);
    row.forEach((value, x) => {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prior[x];
      const upLeft = x >= bpp ? prior[x - bpp] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      if (filter === 2) predicted = up;
      if (filter === 3) predicted = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      raw.push((value - predicted) & 255);
    });
  });
  return Uint8Array.from([
    ...SIGNATURE,
    ...chunk("IHDR", [...u32(width), ...u32(height), bitDepth, colorType, 0, 0, options.interlace ?? 0]),
    ...(options.palette ? chunk("PLTE", options.palette) : []),
    ...(options.transparency ? chunk("tRNS", options.transparency) : []),
    ...chunk("IDAT", deflateSync(Uint8Array.from(raw))),
    ...chunk("IEND", []),
  ]);
}

function expectPixels(png: Uint8Array, expected: number[]) {
  const result = decodePng(png);
  expect(result.ok).toBe(true);
  if (result.ok) expect([...result.pixels.data]).toEqual(expected);
}

describe("decodePng", () => {
  it("reads 8-bit RGBA and RGB", () => {
    expectPixels(
      build({ width: 2, height: 1, colorType: 6, bitDepth: 8, rows: [[1, 2, 3, 4, 5, 6, 7, 8]] }),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    expectPixels(build({ width: 2, height: 1, colorType: 2, bitDepth: 8, rows: [[1, 2, 3, 4, 5, 6]] }), [1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it("reads gray and gray + alpha", () => {
    expectPixels(build({ width: 2, height: 1, colorType: 0, bitDepth: 8, rows: [[10, 200]] }), [10, 10, 10, 255, 200, 200, 200, 255]);
    expectPixels(build({ width: 1, height: 1, colorType: 4, bitDepth: 8, rows: [[90, 40]] }), [90, 90, 90, 40]);
  });

  it("reads palette images, with and without transparency", () => {
    const palette = [255, 0, 0, 0, 255, 0, 0, 0, 255];
    expectPixels(
      build({ width: 3, height: 1, colorType: 3, bitDepth: 8, rows: [[0, 1, 2]], palette }),
      [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255],
    );
    expectPixels(
      build({ width: 3, height: 1, colorType: 3, bitDepth: 8, rows: [[0, 1, 2]], palette, transparency: [0, 128] }),
      [255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255],
    );
  });

  it("unpacks 1, 2 and 4 bit samples", () => {
    // 2-bit palette, four pixels in one byte: indexes 0,1,2,3.
    expectPixels(
      build({ width: 4, height: 1, colorType: 3, bitDepth: 2, rows: [[0b00011011]], palette: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4] }),
      [1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255],
    );
    // 1-bit gray: white, black, white.
    expectPixels(build({ width: 3, height: 1, colorType: 0, bitDepth: 1, rows: [[0b10100000]] }), [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    // 4-bit gray scales 0–15 to 0–255.
    expectPixels(build({ width: 2, height: 1, colorType: 0, bitDepth: 4, rows: [[0x0f]] }), [0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("applies a gray or RGB colour key from tRNS", () => {
    expectPixels(
      build({ width: 2, height: 1, colorType: 0, bitDepth: 8, rows: [[7, 9]], transparency: [0, 7] }),
      [7, 7, 7, 0, 9, 9, 9, 255],
    );
    expectPixels(
      build({ width: 2, height: 1, colorType: 2, bitDepth: 8, rows: [[1, 2, 3, 4, 5, 6]], transparency: [0, 1, 0, 2, 0, 3] }),
      [1, 2, 3, 0, 4, 5, 6, 255],
    );
  });

  it("keeps the high byte of 16-bit samples", () => {
    expectPixels(
      build({ width: 1, height: 1, colorType: 6, bitDepth: 16, rows: [[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xff]] }),
      [0x12, 0x56, 0x9a, 0xff],
    );
  });

  it("undoes every scanline filter", () => {
    const rows = [
      [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255],
      [11, 22, 33, 255, 44, 55, 66, 255, 77, 88, 99, 255],
      [12, 24, 36, 255, 48, 60, 72, 255, 84, 96, 108, 255],
      [13, 26, 39, 255, 52, 65, 78, 255, 91, 104, 117, 255],
      [14, 28, 42, 255, 56, 70, 84, 255, 98, 112, 126, 255],
    ];
    for (const filter of [0, 1, 2, 3, 4]) {
      expectPixels(
        build({ width: 3, height: 5, colorType: 6, bitDepth: 8, rows, filters: [filter, filter, filter, filter, filter] }),
        rows.flat(),
      );
    }
    // Mixed filters on one image, as real encoders produce.
    expectPixels(build({ width: 3, height: 5, colorType: 6, bitDepth: 8, rows, filters: [0, 1, 2, 3, 4] }), rows.flat());
  });

  it("joins a picture split over several data chunks", () => {
    const whole = build({ width: 2, height: 2, colorType: 6, bitDepth: 8, rows: [[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16]] });
    const chunks = chunksOf(whole);
    const data = chunks.find((item) => item.type === "IDAT")?.data as Uint8Array;
    const half = Math.floor(data.length / 2);
    const split = Uint8Array.from([
      ...SIGNATURE,
      ...chunk("IHDR", chunks[0].data),
      ...chunk("IDAT", data.subarray(0, half)),
      ...chunk("IDAT", data.subarray(half)),
      ...chunk("IEND", []),
    ]);
    expectPixels(split, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("says what is wrong instead of guessing", () => {
    expect(decodePng(Uint8Array.from([1, 2, 3]))).toEqual({ ok: false, problem: "not-png" });
    expect(decodePng(new TextEncoder().encode("GIF89a not a png at all"))).toEqual({ ok: false, problem: "not-png" });
    const valid = encodePng(sample());
    expect(decodePng(valid.subarray(0, valid.length - 20))).toEqual({ ok: false, problem: "corrupt" });
    const interlaced = build({ width: 1, height: 1, colorType: 6, bitDepth: 8, rows: [[1, 2, 3, 4]], interlace: 1 });
    expect(decodePng(interlaced)).toEqual({ ok: false, problem: "unsupported" });
    const empty = build({ width: 0, height: 1, colorType: 6, bitDepth: 8, rows: [[]] });
    expect(decodePng(empty)).toEqual({ ok: false, problem: "corrupt" });
  });

  it("refuses a picture bigger than the limit before inflating anything", () => {
    const big = encodePng(createPixels(64, 64));
    expect(decodePng(big, 100)).toEqual({ ok: false, problem: "too-big" });
    expect(decodePng(big, 64 * 64).ok).toBe(true);
  });

  it("refuses a palette index that points past the palette", () => {
    const bad = build({ width: 1, height: 1, colorType: 3, bitDepth: 8, rows: [[5]], palette: [1, 2, 3] });
    expect(decodePng(bad)).toEqual({ ok: false, problem: "corrupt" });
  });
});
