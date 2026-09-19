/**
 * Owner command: /get — unwrap view-once media from a quoted message.
 */
function isGetCommand(text) {
  if (!text || typeof text !== "string") return false;
  return /^\s*\/get\s*$/i.test(text);
}

/**
 * Detect view-once wrappers or viewOnce flags on media.
 * @param {object | null | undefined} content — raw message or quotedMessage
 */
function isViewOnceContent(content) {
  if (!content || typeof content !== "object") return false;
  if (
    content.viewOnceMessage ||
    content.viewOnceMessageV2 ||
    content.viewOnceMessageV2Extension
  ) {
    return true;
  }
  for (const key of ["imageMessage", "videoMessage", "audioMessage", "documentMessage"]) {
    if (content[key]?.viewOnce) return true;
  }
  return false;
}

module.exports = { isGetCommand, isViewOnceContent };
