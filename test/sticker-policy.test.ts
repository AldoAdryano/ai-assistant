import { describe, expect, it } from "vitest";
import { isStickerRequest, resolveStickerAction } from "../src/sticker-policy";

describe("sticker policy", () => {
  it("detects explicit sticker requests", () => {
    expect(isStickerRequest('Buatkan stiker pake foto ini dengan caption "macet"')).toBe(true);
    expect(isStickerRequest("Ubah ini jadi stiker")).toBe(true);
    expect(isStickerRequest("Coba kirim stiker marahmu")).toBe(true);
  });

  it("does not treat a task photo as a sticker request", () => {
    expect(isStickerRequest("Ini loh, yg saya kirim barusan itu 1 tugas doang")).toBe(false);
    expect(isStickerRequest("Nih buktinya")).toBe(false);
  });

  it("ignores MAKE_STICKER when the user did not ask for a sticker", () => {
    expect(resolveStickerAction({
      userText: "Ini loh, yg saya kirim barusan itu 1 tugas doang",
      hasStickerTag: true,
      hasCurrentMedia: true,
    })).toBe("ignore_tag");
  });

  it("builds a sticker from current media when the user asked", () => {
    expect(resolveStickerAction({
      userText: 'Buatkan stiker pake foto ini dengan caption "macet"',
      hasStickerTag: true,
      hasCurrentMedia: true,
    })).toBe("from_media");
  });

  it("detects caption-edit requests as sticker requests", () => {
    expect(isStickerRequest("Tambahin caption UAS")).toBe(true);
    expect(isStickerRequest("kasih caption macet")).toBe(true);
  });
});
