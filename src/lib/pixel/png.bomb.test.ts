/**
 * A PNG whose header says "1×1" but whose pixel stream inflates to far more must
 * never be inflated in full: the header decides how much memory the decoder may use.
 */
import { crc32, deflateSync } from "node:zlib";
import { expect, it, vi } from "vitest";

vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  return { ...actual, unzlibSync: vi.fn(actual.unzlibSync) };
});

import { unzlibSync } from "fflate";
import { decodePng } from "./png";

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function chunk(type: string, data: Uint8Array | number[]): number[] {
  const body = [...type].map((char) => char.charCodeAt(0)).concat([...data]);
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}

it("asks the inflater for no more than the header's size, so a lying file cannot eat memory", () => {
  const header = [...u32(1), ...u32(1), 8, 6, 0, 0, 0];
  const lying = deflateSync(Buffer.alloc(8_000_000));
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", header), ...chunk("IDAT", lying), ...chunk("IEND", [])]);

  const result = decodePng(png);

  const options = vi.mocked(unzlibSync).mock.calls.at(-1)?.[1] as { out?: Uint8Array } | undefined;
  expect(options?.out?.length).toBe(1 + 4); // one filter byte + one RGBA pixel
  expect(result.ok).toBe(true);
});
