/**
 * @param {Array<{ text?: string; imageBase64?: string; audioBase64?: string }>} messages
 */
function mergeMessageBatch(messages) {
  const texts = [];
  let imageBase64;
  let audioBase64;
  for (const msg of messages) {
    if (msg.text && String(msg.text).trim()) texts.push(String(msg.text).trim());
    if (msg.imageBase64) imageBase64 = msg.imageBase64;
    if (msg.audioBase64) audioBase64 = msg.audioBase64;
  }
  const result = { text: texts.join("\n") };
  if (imageBase64) result.imageBase64 = imageBase64;
  if (audioBase64) result.audioBase64 = audioBase64;
  return result;
}

/**
 * @param {{ waitMs: number; now?: () => number; onFlush: (batch: ReturnType<typeof mergeMessageBatch>) => void }} opts
 */
function createMessageBuffer(opts) {
  const waitMs = opts.waitMs;
  const nowFn = opts.now || (() => Date.now());
  const onFlush = opts.onFlush;
  /** @type {Array<{ text?: string; imageBase64?: string; audioBase64?: string }>} */
  let queue = [];
  let timer = null;
  let lastEnqueueAt = 0;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;
    const batch = mergeMessageBatch(queue);
    queue = [];
    onFlush(batch);
  }

  function enqueue(msg) {
    queue.push(msg);
    lastEnqueueAt = nowFn();
    if (timer) clearTimeout(timer);
    // Real timers: schedule flush after waitMs. Test harness can call flush() manually.
    if (typeof setTimeout === "function" && !opts.now) {
      timer = setTimeout(flush, waitMs);
    } else {
      // Custom clock (tests): only flush when caller advances time and calls flush().
      timer = null;
    }
  }

  return { enqueue, flush, _debug: () => ({ queue, lastEnqueueAt }) };
}

module.exports = { mergeMessageBatch, createMessageBuffer };
