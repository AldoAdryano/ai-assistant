function isStickerRequest(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  return /(buat(?:kan)?|bikin|ubah|jadi(?:kan)?|kirim).{0,40}stik[ea]r|stik[ea]r.{0,40}(buat(?:kan)?|bikin|ubah|jadi(?:kan)?|kirim)/i.test(t)
    || (/\bstik[ea]r\b/.test(t) && /(caption|foto|gambar|video|ini|itu|pake|pakai|dari)/i.test(t))
    || /(tambah(?:in|kan)?|kasih|pakai|ubah|ganti|tulis).{0,30}caption/i.test(t)
    || /caption.{0,30}(tambah|kasih|stik|lagi)/i.test(t);
}

/**
 * Best-effort caption text from natural-language requests.
 * e.g. "Tambahin caption UAS" → "UAS"
 */
function extractRequestedCaption(text) {
  if (!text || typeof text !== "string") return null;
  const patterns = [
    /tambah(?:in|kan)?\s+caption\s+["']?(.+?)["']?\s*$/i,
    /caption\s*[:=]\s*["']?(.+?)["']?\s*$/i,
    /dengan\s+caption\s+["']?(.+?)["']?\s*$/i,
    /tulis\s+["']?(.+?)["']?\s*(di|ke)?\s*(stik|gambar)?\s*$/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim().slice(0, 40);
  }
  return null;
}

/**
 * @param {{ userText: string; hasStickerTag: boolean; hasCurrentMedia: boolean }} input
 * @returns {"none" | "from_media" | "from_template" | "ignore_tag"}
 */
function resolveStickerAction(input) {
  const { userText, hasStickerTag, hasCurrentMedia } = input;
  if (!hasStickerTag) return "none";
  if (!isStickerRequest(userText)) return "ignore_tag";
  if (hasCurrentMedia) return "from_media";
  return "from_template";
}

module.exports = { isStickerRequest, extractRequestedCaption, resolveStickerAction };
