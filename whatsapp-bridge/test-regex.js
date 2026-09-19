const r = /\[SYSTEM_ACTION:\s*MAKE_STICKER(?:\s+caption=['"]?([^\]'"]*)['"]?)?\s*\]/i;
const texts = [
  '[SYSTEM_ACTION: MAKE_STICKER]',
  '[SYSTEM_ACTION: MAKE_STICKER caption="Macet"]',
  "[SYSTEM_ACTION: MAKE_STICKER caption='Macet']",
  '[SYSTEM_ACTION: MAKE_STICKER caption=Macet]',
  '[SYSTEM_ACTION:MAKE_STICKER caption="Macet"]'
];

texts.forEach(t => console.log(t.match(r)?.[1]));
