/**
 * Normalize WhatsApp JIDs for comparison (strip device suffix, lowercase).
 * e.g. "62812:61@s.whatsapp.net" → "62812@s.whatsapp.net"
 */
function normalizeJid(jid) {
  if (!jid || typeof jid !== "string") return "";
  const bare = jid.split(":")[0];
  if (bare.includes("@")) return bare.toLowerCase();
  return `${bare}@s.whatsapp.net`.toLowerCase();
}

/** Force a value into a @lid JID (sock.user.lid often returns digits only). */
function asLidJid(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.includes("@lid")) return normalizeJid(s);
  const local = s.split("@")[0].split(":")[0];
  if (!local) return null;
  return `${local}@lid`;
}

function jidLocal(jid) {
  return normalizeJid(jid).split("@")[0] || "";
}

function phoneDigits(jid) {
  const n = normalizeJid(jid);
  if (n.endsWith("@lid")) return "";
  return n.replace(/\D/g, "");
}

function jidsEqual(a, b) {
  if (!a || !b) return false;
  const na = normalizeJid(a);
  const nb = normalizeJid(b);
  if (na === nb) return true;
  // Same local-part: covers 195…@lid vs 195…@s.whatsapp.net (mis-tagged LID)
  const la = jidLocal(a);
  const lb = jidLocal(b);
  if (la && la === lb) return true;
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  return da.length >= 8 && da === db;
}

function jidMatchesAny(jid, identities) {
  if (!jid || !identities || identities.length === 0) return false;
  return identities.some((id) => id && jidsEqual(jid, id));
}

function isGroupJid(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function isLidJid(jid) {
  return typeof jid === "string" && normalizeJid(jid).endsWith("@lid");
}

/**
 * @returns {"owner_chat" | "public_stiker" | "ignore"}
 */
function resolveMessageAccess(input) {
  const {
    remoteJid,
    senderJid,
    ownerIdentities = [],
    botIdentities = [],
    mentionedJids = [],
    quotedParticipantJid = null,
    hasStikerCommand,
  } = input;

  const owners = ownerIdentities.length
    ? ownerIdentities
    : [input.ownerJid].filter(Boolean);
  const bots = botIdentities.length
    ? botIdentities
    : [input.botJid || owners[0]].filter(Boolean);

  if (hasStikerCommand) return "public_stiker";

  const isOwner = jidMatchesAny(senderJid, owners);
  if (!isOwner) return "ignore";

  if (!isGroupJid(remoteJid)) return "owner_chat";

  const mentionTargets = [...bots, ...owners];
  const mentioned = (mentionedJids || []).some((j) => jidMatchesAny(j, mentionTargets));
  const replyToBot = Boolean(quotedParticipantJid) && jidMatchesAny(quotedParticipantJid, mentionTargets);

  if (mentioned || replyToBot) return "owner_chat";
  return "ignore";
}

module.exports = {
  normalizeJid,
  asLidJid,
  jidLocal,
  phoneDigits,
  jidsEqual,
  jidMatchesAny,
  isGroupJid,
  isLidJid,
  resolveMessageAccess,
};
