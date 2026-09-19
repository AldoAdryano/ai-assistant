import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  normalizeJid,
  jidsEqual,
  isGroupJid,
  resolveMessageAccess,
} = require("../whatsapp-bridge/src/access-policy.js");
const { isStikerCommand, stripStikerCommand, parseStikerCommand } = require("../whatsapp-bridge/src/public-stiker.js");

describe("public /stiker command", () => {
  it("detects /stiker as a token anywhere", () => {
    expect(isStikerCommand("/stiker")).toBe(true);
    expect(isStikerCommand("  /STIKER  ")).toBe(true);
    expect(isStikerCommand("/stiker please")).toBe(true);
    expect(isStikerCommand("UAS /stiker")).toBe(true);
    expect(isStikerCommand("tolong /stiker dong")).toBe(true);
    expect(isStikerCommand("/stiker bodo")).toBe(true);
    expect(isStikerCommand("/stiker bodo amat")).toBe(true);
    expect(isStikerCommand("buat stiker")).toBe(false);
    expect(isStikerCommand("/sticker")).toBe(false);
  });

  it("parses caption after /stiker", () => {
    expect(parseStikerCommand("/stiker")).toEqual({ caption: null });
    expect(parseStikerCommand("/stiker bodo")).toEqual({ caption: "bodo" });
    expect(parseStikerCommand("/stiker bodo amat")).toEqual({ caption: "bodo amat" });
    expect(parseStikerCommand("UAS /stiker")).toEqual({ caption: null });
  });

  it("strips the command token", () => {
    expect(stripStikerCommand("/stiker")).toBe("");
    expect(stripStikerCommand("/stiker hello")).toBe("hello");
  });
});

describe("access policy", () => {
  const owner = "628111111111@s.whatsapp.net";
  const ownerLid = "238035878838303@lid";
  const guest = "628222222222@s.whatsapp.net";
  const group = "120363@g.us";

  it("normalizes device-suffixed jids", () => {
    expect(normalizeJid("628111111111:61@s.whatsapp.net")).toBe("628111111111@s.whatsapp.net");
    expect(jidsEqual("628111111111:61@s.whatsapp.net", owner)).toBe(true);
    expect(isGroupJid(group)).toBe(true);
  });

  it("routes anyone with /stiker to public_stiker", () => {
    expect(resolveMessageAccess({
      remoteJid: group,
      senderJid: guest,
      ownerIdentities: [owner],
      hasStikerCommand: true,
    })).toBe("public_stiker");
    expect(resolveMessageAccess({
      remoteJid: guest,
      senderJid: guest,
      ownerIdentities: [owner],
      hasStikerCommand: true,
    })).toBe("public_stiker");
  });

  it("allows owner DM chat without mention", () => {
    expect(resolveMessageAccess({
      remoteJid: owner,
      senderJid: owner,
      ownerIdentities: [owner],
      hasStikerCommand: false,
    })).toBe("owner_chat");
  });

  it("recognizes owner by LID identity", () => {
    expect(resolveMessageAccess({
      remoteJid: owner,
      senderJid: ownerLid,
      ownerIdentities: [owner, ownerLid],
      hasStikerCommand: false,
    })).toBe("owner_chat");
  });

  it("ignores guest chat without /stiker", () => {
    expect(resolveMessageAccess({
      remoteJid: guest,
      senderJid: guest,
      ownerIdentities: [owner],
      hasStikerCommand: false,
    })).toBe("ignore");
  });

  it("allows owner group chat only with @bot or reply-to-bot (incl. LID)", () => {
    expect(resolveMessageAccess({
      remoteJid: group,
      senderJid: ownerLid,
      ownerIdentities: [owner, ownerLid],
      botIdentities: [owner, ownerLid],
      hasStikerCommand: false,
    })).toBe("ignore");

    expect(resolveMessageAccess({
      remoteJid: group,
      senderJid: ownerLid,
      ownerIdentities: [owner, ownerLid],
      botIdentities: [owner, ownerLid],
      mentionedJids: [ownerLid],
      hasStikerCommand: false,
    })).toBe("owner_chat");

    expect(resolveMessageAccess({
      remoteJid: group,
      senderJid: owner,
      ownerIdentities: [owner, ownerLid],
      botIdentities: [owner, ownerLid],
      quotedParticipantJid: ownerLid,
      hasStikerCommand: false,
    })).toBe("owner_chat");
  });

  it("matches bot LID mention even if identity was stored with wrong server", () => {
    expect(resolveMessageAccess({
      remoteJid: group,
      senderJid: owner,
      ownerIdentities: [owner],
      botIdentities: ["195425978060837@s.whatsapp.net"],
      mentionedJids: ["195425978060837@lid"],
      hasStikerCommand: false,
    })).toBe("owner_chat");
  });

  it("treats configured LID and PN as the same owner when both listed", () => {
    const myLid = "238035878838303@lid";
    const myPn = "6288983776936@s.whatsapp.net";
    expect(resolveMessageAccess({
      remoteJid: group,
      senderJid: myPn,
      ownerIdentities: [myPn, myLid],
      botIdentities: ["195425978060837@lid"],
      mentionedJids: ["195425978060837@lid"],
      hasStikerCommand: false,
    })).toBe("owner_chat");
  });
});

describe("/get view-once", () => {
  const { isGetCommand, isViewOnceContent } = require("../whatsapp-bridge/src/view-once-get.js");

  it("detects /get", () => {
    expect(isGetCommand("/get")).toBe(true);
    expect(isGetCommand("  /GET  ")).toBe(true);
    expect(isGetCommand("/get now")).toBe(false);
    expect(isGetCommand("/stiker")).toBe(false);
  });

  it("detects view-once wrappers", () => {
    expect(isViewOnceContent({ viewOnceMessageV2: { message: { imageMessage: {} } } })).toBe(true);
    expect(isViewOnceContent({ imageMessage: { viewOnce: true } })).toBe(true);
    expect(isViewOnceContent({ imageMessage: {} })).toBe(false);
  });
});
