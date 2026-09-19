const { startWhatsApp } = require('./src/whatsapp');

console.log("Starting WhatsApp Bridge...");
startWhatsApp().catch(err => {
  console.error("Fatal error starting bridge:", err);
  process.exit(1);
});
