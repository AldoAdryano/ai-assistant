/**
 * Public sticker command: /stiker [caption...]
 * Examples: "/stiker", "/stiker bodo", "/stiker bodo amat", "UAS /stiker"
 */

/**
 * @param {string | null | undefined} text
 * @returns {{ caption: string | null } | null}
 */
function parseStikerCommand(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/(?:^|\s)\/stiker(?:\s+([^\n]*))?$/i)
    || text.match(/(?:^|\s)\/stiker(?:\s+([^\n]*))/i);
  if (!m) return null;
  const caption = (m[1] || "").trim();
  return { caption: caption || null };
}

function isStikerCommand(text) {
  return parseStikerCommand(text) !== null;
}

/**
 * Strip /stiker and return leftover caption text (may be empty).
 */
function stripStikerCommand(text) {
  const parsed = parseStikerCommand(text);
  if (!parsed) return typeof text === "string" ? text.trim() : "";
  return parsed.caption || "";
}

module.exports = { parseStikerCommand, isStikerCommand, stripStikerCommand };
