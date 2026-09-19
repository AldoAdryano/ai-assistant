const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, extractMessageContent } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { getConfig } = require('./config');
const { resolveStickerAction, isStickerRequest, extractRequestedCaption } = require('./sticker-policy');
const { createMessageBuffer } = require('./message-buffer');
const { resolveMessageAccess, jidsEqual, isGroupJid, normalizeJid, asLidJid, jidMatchesAny } = require('./access-policy');
const { isStikerCommand, parseStikerCommand } = require('./public-stiker');
const { isGetCommand, isViewOnceContent } = require('./view-once-get');
const fs = require('fs');
const path = require('path');

const config = getConfig();
console.log(`[boot] owners=${config.ownerJids.join(',')} workerFrom=${config.workerFrom}`);

if (config.lightMode) {
  console.log("[LIGHT_MODE] Sticker/ffmpeg disabled — teks, gambar, audio, alarm tetap jalan.");
}

let buildImageSticker = null;
let buildVideoSticker = null;
if (!config.lightMode) {
  try {
    ({ buildImageSticker, buildVideoSticker } = require('./media'));
  } catch (err) {
    console.error("[WARN] media.js gagal load, fallback ke LIGHT_MODE:", err.message);
    config.lightMode = true;
  }
}

// Store last media with its type: { buffer, type: 'image'|'video' }
let lastMedia = {};

/** @type {string | null} */
let botJid = null;
/** @type {string | null} */
let botLid = null;
/** Extra owner PN/LID learned at runtime (paired with configured identities). */
const learnedOwnerJids = new Set();

function ownerIdentities() {
  return [
    ...config.ownerJids,
    config.ownerPnJid,
    config.ownerLidJid,
    ...learnedOwnerJids,
  ].filter(Boolean);
}

function botIdentities() {
  // Bot account only — JANGAN campur owner (Youyou bisa beda nomor dari Aldo)
  return [botJid, botLid].filter(Boolean);
}

function rememberOwnerPair(pn, lid) {
  if (pn) learnedOwnerJids.add(normalizeJid(pn));
  if (lid) learnedOwnerJids.add(asLidJid(lid));
}

async function refreshIdentityMap(sock) {
  botJid = sock.user?.id ? normalizeJid(sock.user.id) : botJid;
  if (sock.user?.lid) {
    botLid = asLidJid(sock.user.lid);
  }
  try {
    const mapping = sock.signalRepository?.lidMapping;
    if (mapping?.getLIDForPN && config.ownerPnJid) {
      const lid = await mapping.getLIDForPN(config.ownerPnJid);
      if (lid) rememberOwnerPair(config.ownerPnJid, lid);
    }
    if (mapping?.getPNForLID && config.ownerLidJid) {
      const pn = await mapping.getPNForLID(config.ownerLidJid);
      if (pn) rememberOwnerPair(pn, config.ownerLidJid);
    }
    if (mapping?.getLIDForPN && botJid) {
      const bl = await mapping.getLIDForPN(botJid);
      if (bl) botLid = asLidJid(bl);
    }
  } catch (err) {
    console.log("[WARN] LID mapping unavailable:", err.message || err);
  }
  console.log(
    `[identity] bot=${botJid || '-'} botLid=${botLid || '-'} owners=${ownerIdentities().join(',')}`
  );
}

let pollInterval = null;
function startPolling(sock) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const res = await axios.get(`${config.WORKER_URL}/whatsapp/poll`, {
        headers: { 'X-WhatsApp-Api-Secret': config.WHATSAPP_API_SECRET }
      });
      if (res.data && res.data.alarms && res.data.alarms.length > 0) {
        for (const alarm of res.data.alarms) {
          await sock.sendMessage(config.targetJid, { text: alarm });
        }
      }
    } catch (err) {
      // Intentionally ignoring poll errors to avoid console spam
    }
  }, 10000);
}

function getContextInfo(msg) {
  const m = msg.message || {};
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.buttonsResponseMessage?.contextInfo ||
    m.templateButtonReplyMessage?.contextInfo ||
    m.listResponseMessage?.contextInfo ||
    null
  );
}

function getSenderJid(msg) {
  const remote = msg.key.remoteJid || "";
  if (isGroupJid(remote)) {
    // Prefer phone-number form when WhatsApp only gives @lid on participant
    return (
      msg.key.participantPn ||
      msg.key.participant ||
      msg.participant ||
      msg.key.senderPn ||
      ""
    );
  }
  return msg.key.senderPn || msg.key.remoteJid || "";
}

function extractMessageText(msg) {
  const m = msg.message || {};
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.stickerMessage) return "[User mengirimkan sebuah ekspresi stiker]";
  return "";
}

async function downloadMsgMedia(msg, mediaMsg, kind) {
  const buffer = await downloadMediaMessage(
    mediaMsg.url ? { message: { [kind === 'image' ? 'imageMessage' : 'videoMessage']: mediaMsg } } : msg,
    'buffer',
    {},
    { logger: pino({ level: 'silent' }) }
  );
  return buffer;
}

/**
 * Resolve image/video/sticker from current message, quoted message, or lastMedia.
 * @returns {Promise<{ buffer: Buffer, type: 'image'|'video' } | null>}
 */
async function resolveStikerMedia(msg, remoteJid) {
  const m = msg.message || {};
  const ctx = getContextInfo(msg);
  const quoted = ctx?.quotedMessage;

  const imageMsg = m.imageMessage || quoted?.imageMessage;
  if (imageMsg) {
    const buffer = await downloadMsgMedia(msg, imageMsg, 'image');
    return { buffer, type: 'image' };
  }

  const videoMsg = m.videoMessage || quoted?.videoMessage;
  if (videoMsg) {
    if (config.lightMode || process.env.STICKER_VIDEO === "0" || process.env.STICKER_VIDEO === "false") {
      console.log("[media] Public /stiker video skipped (light mode or STICKER_VIDEO=0)");
      return null;
    }
    const buffer = await downloadMsgMedia(msg, videoMsg, 'video');
    return { buffer, type: 'video' };
  }

  const stickerMsg = m.stickerMessage || quoted?.stickerMessage;
  if (stickerMsg) {
    try {
      const buffer = await downloadMediaMessage(
        stickerMsg.directPath || stickerMsg.url
          ? { message: { stickerMessage: stickerMsg } }
          : msg,
        'buffer',
        {},
        { logger: pino({ level: 'silent' }) }
      );
      return { buffer, type: 'image' };
    } catch (err) {
      console.error("[ERROR] Failed to download quoted sticker:", err.message || err);
    }
  }

  if (remoteJid && lastMedia[remoteJid]) {
    console.log(`[DEBUG] Using lastMedia fallback (${lastMedia[remoteJid].type})`);
    return lastMedia[remoteJid];
  }

  return null;
}

async function buildAndSendSticker(sock, remoteJid, mediaInfo, caption, { silentFail = false } = {}) {
  try {
    let stickerBuffer;
    if (mediaInfo.type === 'video') {
      stickerBuffer = await buildVideoSticker(mediaInfo.buffer, caption);
    } else {
      stickerBuffer = await buildImageSticker(mediaInfo.buffer, caption);
    }
    await sock.sendMessage(remoteJid, { sticker: stickerBuffer });
    console.log(`[DEBUG] Sticker sent successfully! (${stickerBuffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error("[ERROR] Sticker error:", { error: err.message, stack: err.stack });
    if (!silentFail) {
      await sock.sendMessage(remoteJid, { text: "Hih! Gagal membuat stiker! Formatnya mungkin tidak didukung atau ukurannya terlalu besar!" });
    }
    return false;
  }
}

async function sendTemplateSticker(sock, remoteJid, caption) {
  let reactionType = caption ? caption.toLowerCase().trim() : "default";
  let templatePath = path.join(__dirname, '..', 'stickers', `${reactionType}.webp`);
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(__dirname, '..', 'stickers', 'default.webp');
  }
  try {
    if (!fs.existsSync(templatePath)) {
      await sock.sendMessage(remoteJid, { text: "Stiker template-nya belum ada di HP ini!" });
      return;
    }
    const stickerBuffer = fs.readFileSync(templatePath);
    await sock.sendMessage(remoteJid, { sticker: stickerBuffer });
    console.log(`[DEBUG] Template Sticker sent: ${reactionType}`);
  } catch (err) {
    console.error("[ERROR] Failed to send template sticker", err);
    await sock.sendMessage(remoteJid, { text: "Stikernya nyangkut!" });
  }
}

async function sendStickerReply(sock, remoteJid, reply, userText) {
  const stickerMatch = reply.match(/\[SYSTEM_ACTION:\s*MAKE_STICKER(?:\s+caption=['"]?([^\]'"]*)['"]?)?\s*\]/i);
  const mediaInfo = lastMedia[remoteJid];
  const userAsked = isStickerRequest(userText || "");

  // Gemini sering lupa tag / bilang "kirim foto" padahal lastMedia sudah ada (video tidak dikirim ke Worker).
  if (!stickerMatch) {
    if (reply && String(reply).trim()) {
      await sock.sendMessage(remoteJid, { text: reply });
    }
    if (!config.lightMode && userAsked && mediaInfo) {
      const autoCaption = extractRequestedCaption(userText) || null;
      console.log(`[DEBUG] Auto MAKE_STICKER from lastMedia (${mediaInfo.type}) — Gemini lupa tag`);
      await buildAndSendSticker(sock, remoteJid, mediaInfo, autoCaption);
    }
    return;
  }

  const caption = stickerMatch[1] || null;
  const cleanReply = reply.replace(/\[SYSTEM_ACTION:\s*MAKE_STICKER(?:\s+caption=['"]?[^\]'"]*['"]?)?\s*\]/i, '').trim();
  if (cleanReply) await sock.sendMessage(remoteJid, { text: cleanReply });

  if (config.lightMode) {
    await sock.sendMessage(remoteJid, {
      text: "Hih, mode ringan di HP: stiker dimatikan biar RAM-nya tidak meledak. Chat teks tetap jalan, Tuan Muda!"
    });
    return;
  }

  const action = resolveStickerAction({
    userText: userText || "",
    hasStickerTag: true,
    hasCurrentMedia: Boolean(mediaInfo),
  });

  if (action === "ignore_tag" || action === "none") {
    console.log("[DEBUG] Ignoring MAKE_STICKER — user did not request a sticker");
    return;
  }

  if (action === "from_media" && mediaInfo) {
    await buildAndSendSticker(sock, remoteJid, mediaInfo, caption);
    return;
  }

  await sendTemplateSticker(sock, remoteJid, caption);
}

function mediaBridgeHint(remoteJid) {
  const media = lastMedia[remoteJid];
  if (!media) return "";
  const kind = media.type === "video" ? "video" : "gambar";
  return (
    `\n\n[Bridge: media terakhir tersimpan di bridge — type=${kind}. ` +
    `Kalau user minta stiker dari media itu, WAJIB [SYSTEM_ACTION: MAKE_STICKER] ` +
    `dan JANGAN bilang belum ada foto/video / minta kirim ulang.]`
  );
}

async function handlePublicStiker(sock, remoteJid, msg, userText) {
  if (config.lightMode || !buildImageSticker) {
    console.log("[DEBUG] Public /stiker ignored (light mode)");
    return;
  }
  try {
    const parsed = parseStikerCommand(userText || "");
    const caption = parsed?.caption || null;
    const media = await resolveStikerMedia(msg, remoteJid);
    if (!media) {
      console.log("[DEBUG] Public /stiker tanpa media — silent");
      return;
    }
    lastMedia[remoteJid] = media;
    console.log(`[DEBUG] Public /stiker ${media.type} (${media.buffer.length} bytes) caption=${caption ? JSON.stringify(caption) : "-"}`);
    await buildAndSendSticker(sock, remoteJid, media, caption, { silentFail: true });
  } catch (err) {
    console.error("[ERROR] Public /stiker failed:", { error: err.message, stack: err.stack });
  }
}

/**
 * Owner-only: reply view-once + /get → re-send as normal media (not view-once).
 */
async function handleGetViewOnce(sock, remoteJid, msg) {
  const ctx = getContextInfo(msg);
  const quoted = ctx?.quotedMessage;
  if (!quoted) {
    await sock.sendMessage(remoteJid, { text: "Reply dulu ke pesan *sekali lihat*, baru ketik /get." });
    return;
  }

  const unwrapped = extractMessageContent(quoted) || quoted;
  const looksViewOnce = isViewOnceContent(quoted) || isViewOnceContent(unwrapped);
  if (!looksViewOnce) {
    // Still allow if quoted is plain media that was view-once (flag may be stripped after open)
    const hasMedia = !!(unwrapped?.imageMessage || unwrapped?.videoMessage || unwrapped?.audioMessage);
    if (!hasMedia) {
      await sock.sendMessage(remoteJid, { text: "Itu bukan pesan sekali lihat (foto/video/VN)." });
      return;
    }
    console.log("[DEBUG] /get: quoted media without viewOnce flag — tetap dicoba");
  }

  const imageMsg = unwrapped.imageMessage;
  const videoMsg = unwrapped.videoMessage;
  const audioMsg = unwrapped.audioMessage;

  try {
    if (imageMsg) {
      const buffer = await downloadMediaMessage(
        { message: { imageMessage: imageMsg } },
        "buffer",
        {},
        { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
      );
      await sock.sendMessage(remoteJid, {
        image: buffer,
        caption: imageMsg.caption || undefined,
      });
      console.log(`[DEBUG] /get image sent (${buffer.length} bytes)`);
      return;
    }
    if (videoMsg) {
      const buffer = await downloadMediaMessage(
        { message: { videoMessage: videoMsg } },
        "buffer",
        {},
        { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
      );
      await sock.sendMessage(remoteJid, {
        video: buffer,
        caption: videoMsg.caption || undefined,
      });
      console.log(`[DEBUG] /get video sent (${buffer.length} bytes)`);
      return;
    }
    if (audioMsg) {
      const buffer = await downloadMediaMessage(
        { message: { audioMessage: audioMsg } },
        "buffer",
        {},
        { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
      );
      await sock.sendMessage(remoteJid, {
        audio: buffer,
        mimetype: audioMsg.mimetype || "audio/ogg; codecs=opus",
        ptt: Boolean(audioMsg.ptt),
      });
      console.log(`[DEBUG] /get audio sent (${buffer.length} bytes)`);
      return;
    }
    await sock.sendMessage(remoteJid, { text: "Media sekali lihat-nya tidak bisa diambil (tipe tidak didukung)." });
  } catch (err) {
    console.error("[ERROR] /get failed:", { error: err.message, stack: err.stack });
    await sock.sendMessage(remoteJid, {
      text: "Gagal mengambil media sekali lihat. Mungkin sudah kadaluarsa atau belum terbuka di perangkat linked.",
    });
  }
}

async function forwardToWorker(sock, remoteJid, payload) {
  try {
    await sock.sendPresenceUpdate('composing', remoteJid);
    const typingInterval = setInterval(() => {
      sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
    }, 8000);

    const textWithHint = `${payload.text || ""}${mediaBridgeHint(remoteJid)}`;

    let res;
    try {
      res = await axios.post(`${config.WORKER_URL}/whatsapp`, {
        from: config.workerFrom,
        text: textWithHint,
        imageBase64: payload.imageBase64,
        audioBase64: payload.audioBase64,
        chatContext: isGroupJid(remoteJid) ? "group" : "dm",
        chatId: remoteJid,
      }, {
        headers: { 'X-WhatsApp-Api-Secret': config.WHATSAPP_API_SECRET },
        timeout: 180000
      });
    } finally {
      clearInterval(typingInterval);
    }

    await sock.sendPresenceUpdate('paused', remoteJid);

    if (res.data && res.data.replies) {
      for (const reply of res.data.replies) {
        // Pakai teks user asli (tanpa hint bridge) untuk policy stiker
        await sendStickerReply(sock, remoteJid, reply, payload.text || "");
      }
    }
  } catch (err) {
    console.error("[ERROR] Error forwarding message to Worker:", { error: err.message, stack: err.stack });
    await sock.sendMessage(remoteJid, { text: "⚠️ Maaf, gagal terhubung ke server utama." });
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  /** Recent outbound messages for WhatsApp retry ("Menunggu pesan ini…") */
  const recentOutbound = new Map();
  const REMEMBER_LIMIT = 80;

  function rememberOutbound(key, content) {
    if (!key?.id || !content) return;
    recentOutbound.set(key.id, content);
    if (recentOutbound.size > REMEMBER_LIMIT) {
      const first = recentOutbound.keys().next().value;
      recentOutbound.delete(first);
    }
  }

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async (key) => {
      if (key?.id && recentOutbound.has(key.id)) {
        return recentOutbound.get(key.id);
      }
      return undefined;
    },
  });

  // Patch sendMessage to remember content for retry requests
  const _sendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const sent = await _sendMessage(jid, content, options);
    try {
      if (sent?.key?.id && sent.message) {
        rememberOutbound(sent.key, sent.message);
      }
    } catch (_) {}
    return sent;
  };

  // Coalesce forwarded bursts (e.g. group task paste) into one Worker request.
  const buffersByJid = new Map();
  function getBuffer(remoteJid) {
    if (!buffersByJid.has(remoteJid)) {
      buffersByJid.set(remoteJid, createMessageBuffer({
        waitMs: 2500,
        onFlush: (batch) => {
          forwardToWorker(sock, remoteJid, batch).catch((err) => {
            console.error("[ERROR] Buffered flush failed:", err);
          });
        }
      }));
    }
    return buffersByJid.get(remoteJid);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
      if (shouldReconnect) {
        startWhatsApp();
      } else {
        console.error("[FATAL] WhatsApp connection closed with 401 Unauthorized.");
      }
    } else if (connection === 'open') {
      refreshIdentityMap(sock).catch(() => {});
      console.log(`WhatsApp connection opened (bot=${botJid || 'unknown'})`);
      startPolling(sock);
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return;
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid === 'status@broadcast') return;

      const senderJid = getSenderJid(msg);
      const text = extractMessageText(msg);
      const ctx = getContextInfo(msg);
      const mentionedJids = ctx?.mentionedJid || [];
      // Quoted participant may be LID — match via botIdentities/ownerIdentities
      const quotedParticipantJid = ctx?.participant || null;
      const hasStiker = isStikerCommand(text);

      // Cache owner PN↔LID pairs from this message
      if (msg.key.participantPn && msg.key.participant) {
        const pn = msg.key.participantPn;
        const part = msg.key.participant;
        if (String(part).includes("@lid") && ownerIdentities().some((id) => jidsEqual(id, pn) || jidsEqual(id, part))) {
          rememberOwnerPair(pn, part);
        }
      }
      if (msg.key.participantLid && msg.key.participantPn) {
        if (ownerIdentities().some((id) => jidsEqual(id, msg.key.participantPn) || jidsEqual(id, msg.key.participantLid))) {
          rememberOwnerPair(msg.key.participantPn, msg.key.participantLid);
        }
      }
      if (msg.key.senderLid && msg.key.senderPn) {
        if (ownerIdentities().some((id) => jidsEqual(id, msg.key.senderPn) || jidsEqual(id, msg.key.senderLid))) {
          rememberOwnerPair(msg.key.senderPn, msg.key.senderLid);
        }
      }
      // Learn bot LID from @mentions
      for (const m of mentionedJids) {
        if (String(m).includes("@lid")) {
          botLid = asLidJid(m);
          break;
        }
      }

      // Owner-only /get — works without @mention (reply to view-once is enough)
      if (isGetCommand(text)) {
        if (!jidMatchesAny(senderJid, ownerIdentities())) {
          console.log(`[DEBUG] /get ignored (not owner) from=${normalizeJid(senderJid)}`);
          return;
        }
        console.log(`[DEBUG] /get from owner in ${remoteJid}`);
        try {
          await sock.readMessages([msg.key]);
        } catch (_) {}
        await handleGetViewOnce(sock, remoteJid, msg);
        return;
      }

      const access = resolveMessageAccess({
        remoteJid,
        senderJid,
        ownerIdentities: ownerIdentities(),
        botIdentities: botIdentities(),
        mentionedJids,
        quotedParticipantJid,
        hasStikerCommand: hasStiker,
      });

      if (access === "ignore") {
        if (isGroupJid(remoteJid)) {
          const owners = ownerIdentities().join("|") || "-";
          const bots = botIdentities().join("|") || "-";
          console.log(
            `[DEBUG] Ignored group msg from=${normalizeJid(senderJid)} ` +
            `owners=${owners} bots=${bots} ` +
            `mentions=${JSON.stringify(mentionedJids)} quoted=${quotedParticipantJid || '-'} ` +
            `text=${String(text).slice(0, 40)}`
          );
        }
        return;
      }

      if (access === "public_stiker") {
        console.log(`Public /stiker from ${normalizeJid(senderJid)} in ${remoteJid}`);
        try {
          await sock.readMessages([msg.key]);
        } catch (_) {}
        await handlePublicStiker(sock, remoteJid, msg, text);
        return;
      }

      // owner_chat — existing full Youyou path
      let imageBase64 = undefined;
      let audioBase64 = undefined;
      let ownerText = text;

      const imageMsg = msg.message.imageMessage || ctx?.quotedMessage?.imageMessage;
      if (imageMsg) {
        try {
          const buffer = await downloadMsgMedia(msg, imageMsg, 'image');
          if (config.lightMode && buffer.length > 1_500_000) {
            console.log(`[LIGHT_MODE] Image terlalu besar (${buffer.length} bytes), skip base64`);
            ownerText = imageMsg.caption || ownerText || "[User mengirim gambar besar — tidak diproses di mode ringan]";
          } else {
            imageBase64 = buffer.toString('base64');
            lastMedia[remoteJid] = { buffer, type: 'image' };
            console.log(`[DEBUG] Image saved to lastMedia (${buffer.length} bytes)`);
            ownerText = imageMsg.caption || ownerText;
          }
        } catch (err) {
          console.error("[ERROR] Failed to download image:", { error: err.message, stack: err.stack });
        }
      } else {
        const audioMsg = msg.message.audioMessage || ctx?.quotedMessage?.audioMessage;
        if (audioMsg) {
          try {
            const buffer = await downloadMediaMessage(
              audioMsg.url ? { message: { audioMessage: audioMsg } } : msg,
              'buffer', {}, { logger: pino({ level: 'silent' }) }
            );
            audioBase64 = buffer.toString('base64');
          } catch (err) {
            console.error("[ERROR] Failed to download audio:", { error: err.message, stack: err.stack });
          }
        } else {
          const videoMsg = msg.message.videoMessage || ctx?.quotedMessage?.videoMessage;
          if (videoMsg) {
            if (config.lightMode || process.env.STICKER_VIDEO === "0" || process.env.STICKER_VIDEO === "false") {
              ownerText = videoMsg.caption || ownerText || "[User mengirim video — dilewati (stiker video off)]";
              console.log("[media] Video skipped (light mode or STICKER_VIDEO=0)");
            } else {
              try {
                const buffer = await downloadMsgMedia(msg, videoMsg, 'video');
                lastMedia[remoteJid] = { buffer, type: 'video' };
                console.log(`[DEBUG] Video saved to lastMedia (${buffer.length} bytes)`);
                ownerText = videoMsg.caption || ownerText;
              } catch (err) {
                console.error("[ERROR] Failed to download video:", { error: err.message, stack: err.stack });
              }
            }
          } else {
            const stickerMsg = msg.message.stickerMessage || ctx?.quotedMessage?.stickerMessage;
            if (stickerMsg) {
              try {
                const media = await resolveStikerMedia(msg, remoteJid);
                if (media) {
                  lastMedia[remoteJid] = media;
                  console.log(`[DEBUG] Quoted/current sticker saved to lastMedia (${media.buffer.length} bytes)`);
                }
              } catch (err) {
                console.error("[ERROR] Failed to load sticker for lastMedia:", err.message || err);
              }
            }
          }
        }
      }

      // Caption-edit without new media: keep hint via lastMedia
      if (!imageBase64 && lastMedia[remoteJid] && isStickerRequest(ownerText)) {
        // no-op — mediaBridgeHint will inform Worker
      }

      if (!ownerText && !imageBase64 && !audioBase64) return;
      console.log(`Received message: ${String(ownerText).slice(0, 50)}...`);

      try {
        await sock.readMessages([msg.key]);
      } catch (_) {}

      getBuffer(remoteJid).enqueue({ text: ownerText, imageBase64, audioBase64 });
    } catch (err) {
      console.error("[FATAL ERROR] Unhandled exception in messages.upsert handler:", { error: err.message, stack: err.stack });
    }
  });
}

module.exports = { startWhatsApp };
