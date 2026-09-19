require('dotenv').config();
const { normalizeJid, asLidJid, isLidJid } = require('./access-policy');

/**
 * Parse owner identities from env.
 * Examples:
 *   6288983776936
 *   238035878838303@lid
 *   6288983776936,238035878838303@lid
 */
function parseOwnerJids(raw) {
  return String(raw)
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p.includes("@lid")) return asLidJid(p);
      // LID user ids are long digit strings without @
      if (!p.includes("@") && /^\d+$/.test(p) && p.length >= 15) return asLidJid(p);
      if (p.includes("@")) return normalizeJid(p);
      return normalizeJid(`${p}@s.whatsapp.net`);
    })
    .filter(Boolean);
}

function getConfig() {
  const WORKER_URL = process.env.WORKER_URL;
  const WHATSAPP_API_SECRET = process.env.WHATSAPP_API_SECRET;
  const ALLOWED_WHATSAPP_NUMBER = process.env.ALLOWED_WHATSAPP_NUMBER;

  if (!WORKER_URL || !WHATSAPP_API_SECRET || !ALLOWED_WHATSAPP_NUMBER) {
    throw new Error("Missing required environment variables");
  }

  const ownerJids = parseOwnerJids(ALLOWED_WHATSAPP_NUMBER);
  if (ownerJids.length === 0) {
    throw new Error("ALLOWED_WHATSAPP_NUMBER is empty/invalid");
  }

  // Prefer phone JID for Worker `from` + alarms; fall back to first identity
  const ownerPnJid = ownerJids.find((j) => !isLidJid(j)) || null;
  const ownerLidJid = ownerJids.find((j) => isLidJid(j)) || null;
  const targetJid = ownerPnJid || ownerJids[0];

  // Value sent to Worker must match Cloudflare ALLOWED_WHATSAPP_NUMBER (usually digits / PN)
  const workerFrom = ownerPnJid
    ? ownerPnJid.replace(/@s\.whatsapp\.net$/i, "")
    : ALLOWED_WHATSAPP_NUMBER.split(/[,;\s]+/)[0].trim();

  const lightMode = process.env.LIGHT_MODE === "1" || process.env.LIGHT_MODE === "true";

  return {
    WORKER_URL,
    WHATSAPP_API_SECRET,
    ALLOWED_WHATSAPP_NUMBER,
    ownerJids,
    ownerPnJid,
    ownerLidJid,
    targetJid,
    workerFrom,
    lightMode,
  };
}

module.exports = { getConfig, parseOwnerJids };
