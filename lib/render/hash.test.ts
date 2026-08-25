import { describe, expect, test } from "vitest";
import { sha256Hex, hashObj, segmentKey } from "./hash";

describe("sha256Hex — FIPS 180-4 known-answer vectors", () => {
  test("empty string", () => expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
  test('"abc"', () => expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  test("56-byte / multi-block message", () =>
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ));
  test("utf-8 multibyte is deterministic + 64 hex chars", () => {
    const a = sha256Hex("café — 日本語 🎬");
    expect(a).toBe(sha256Hex("café — 日本語 🎬"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashObj — canonical, key-order independent", () => {
  test("key order does not change the hash", () => {
    expect(hashObj({ a: 1, b: 2 })).toBe(hashObj({ b: 2, a: 1 }));
    expect(hashObj({ p: { x: 1, y: 2 } })).toBe(hashObj({ p: { y: 2, x: 1 } }));
  });
  test("different content → different hash", () => {
    expect(hashObj({ a: 1 })).not.toBe(hashObj({ a: 2 }));
  });
});

describe("segmentKey", () => {
  const base = { serveUrl: "s", nodeHash: "n", renderSettings: { fps: 30, width: 1920 }, engineFingerprint: "e", assetContentHashes: ["x"] };
  test("deterministic for identical parts", () => expect(segmentKey(base)).toBe(segmentKey({ ...base })));
  test("node hash change busts the key", () => expect(segmentKey(base)).not.toBe(segmentKey({ ...base, nodeHash: "n2" })));
  test("engine fingerprint change busts the key", () => expect(segmentKey(base)).not.toBe(segmentKey({ ...base, engineFingerprint: "e2" })));
});
