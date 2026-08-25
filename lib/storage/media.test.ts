import { describe, test, expect } from "vitest";
import {
  MAX_ASSET_DURATION_MS,
  MAX_UPLOAD_BYTES,
  MEDIA_FILE_ACCEPT,
  MEDIA_MIME_KINDS,
  MEDIA_MIME_TYPES,
  assetKindForMime,
  describeUnsupportedFile,
  formatBytes,
  mediaObjectPath,
  storageObjectName,
  storagePathOwner,
} from "@/lib/storage/media";

/**
 * The regression these lock down: the file picker used to advertise
 * `video/*,audio/*,image/*` while the server accepted nine specific types, so `.mkv`,
 * `.avi`, `.m4a` and `.gif` passed the picker and then failed mid-upload with a raw
 * storage error. There is now ONE table and everything else derives from it.
 */

describe("media type allowlist", () => {
  test("the picker's accept attribute is derived from the allowlist, not hand-written", () => {
    expect(MEDIA_FILE_ACCEPT.split(",").sort()).toEqual([...MEDIA_MIME_TYPES].sort());
    // The wildcard form is what let the picker and the server disagree.
    expect(MEDIA_FILE_ACCEPT).not.toContain("*");
  });

  test("the formats the picker used to accept and the server used to reject now agree", () => {
    // .m4a and .gif were the reported casualties — they are accepted by BOTH sides now.
    expect(assetKindForMime("audio/x-m4a")).toBe("audio");
    expect(assetKindForMime("audio/mp4")).toBe("audio");
    expect(assetKindForMime("image/gif")).toBe("image");
    for (const mime of ["audio/x-m4a", "audio/mp4", "image/gif"]) {
      expect(MEDIA_FILE_ACCEPT).toContain(mime);
    }
  });

  test("formats no browser can decode are refused by BOTH the picker and the server", () => {
    // Accepting these would mean an asset with no readable duration and a black preview.
    expect(assetKindForMime("video/x-matroska")).toBeNull();
    expect(assetKindForMime("video/x-msvideo")).toBeNull();
    expect(MEDIA_FILE_ACCEPT).not.toContain("matroska");
    expect(MEDIA_FILE_ACCEPT).not.toContain("msvideo");
  });

  test("a content type with parameters or casing still resolves", () => {
    expect(assetKindForMime("VIDEO/MP4")).toBe("video");
    expect(assetKindForMime("video/mp4; codecs=avc1")).toBe("video");
  });

  test("an empty content type is unknown, never guessed", () => {
    expect(assetKindForMime("")).toBeNull();
    expect(assetKindForMime("application/octet-stream")).toBeNull();
  });

  test("every entry maps to a kind the asset table accepts", () => {
    for (const kind of Object.values(MEDIA_MIME_KINDS)) {
      expect(["video", "audio", "image"]).toContain(kind);
    }
  });

  test("the refusal names the file and the extension", () => {
    const message = describeUnsupportedFile("holiday.MKV", "video/x-matroska");
    expect(message).toContain("holiday.MKV");
    expect(message).toContain(".mkv");
  });

  test("the refusal still says something useful with no extension and no type", () => {
    expect(describeUnsupportedFile("rawfile", "")).toContain("that file type");
  });
});

describe("object paths", () => {
  test("the path is {userId}/{uploadId}/{filename} — the prefix the storage policies key on", () => {
    const path = mediaObjectPath({ userId: "user-1", uploadId: "upload-1", filename: "clip.mp4" });
    expect(path).toBe("user-1/upload-1/clip.mp4");
    expect(storagePathOwner(path)).toBe("user-1");
  });

  test("two users uploading the same filename get different keys", () => {
    const a = mediaObjectPath({ userId: "a", uploadId: "u1", filename: "IMG_1234.MOV" });
    const b = mediaObjectPath({ userId: "b", uploadId: "u2", filename: "IMG_1234.MOV" });
    expect(a).not.toBe(b);
  });

  test("one user uploading the same filename twice gets different keys", () => {
    const first = mediaObjectPath({ userId: "a", uploadId: "u1", filename: "IMG_1234.MOV" });
    const second = mediaObjectPath({ userId: "a", uploadId: "u2", filename: "IMG_1234.MOV" });
    expect(first).not.toBe(second);
  });

  test("filenames are reduced to key-safe characters, extension preserved", () => {
    expect(storageObjectName("my holiday (final) #2.mp4")).toBe("my_holiday_final_2.mp4");
    expect(storageObjectName("café — cut.mov")).toMatch(/\.mov$/);
    expect(storageObjectName("../../etc/passwd")).not.toContain("/");
  });

  test("a filename that sanitizes to nothing still yields a usable key", () => {
    expect(storageObjectName("///")).toBe("upload");
    expect(storageObjectName("")).toBe("upload");
  });

  test("a very long filename keeps its tail so the extension survives", () => {
    const name = storageObjectName(`${"a".repeat(400)}.mp4`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(".mp4")).toBe(true);
  });

  test("a path with no owner segment has no owner — it is not attributed to anyone", () => {
    expect(storagePathOwner("clip.mp4")).toBeNull();
    expect(storagePathOwner("")).toBeNull();
    expect(storagePathOwner("/leading-slash/clip.mp4")).toBeNull();
    expect(storagePathOwner("user//clip.mp4")).toBeNull();
  });
});

describe("bounds", () => {
  test("the duration ceiling matches the asset_probe_sane DB constraint (24h)", () => {
    expect(MAX_ASSET_DURATION_MS).toBe(86_400_000);
  });

  test("the upload cap is what Storage actually accepts, and it reads as that number", () => {
    // It advertised 2 GiB while the project's global storage limit (50 MiB in supabase/config.toml
    // and on Supabase's free tier) rejected everything past 50 MiB mid-transfer. The picker's
    // refusal quotes this constant, so the sentence the user reads moves with it.
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("50 MB");
  });

  test("byte sizes read as sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_147_483_648)).toBe("2.0 GB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });
});
