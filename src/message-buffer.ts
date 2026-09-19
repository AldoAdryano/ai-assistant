export type BufferedMessage = {
  text?: string;
  imageBase64?: string;
  audioBase64?: string;
};

export function mergeMessageBatch(messages: BufferedMessage[]): BufferedMessage {
  const texts: string[] = [];
  let imageBase64: string | undefined;
  let audioBase64: string | undefined;
  for (const msg of messages) {
    if (msg.text && String(msg.text).trim()) texts.push(String(msg.text).trim());
    if (msg.imageBase64) imageBase64 = msg.imageBase64;
    if (msg.audioBase64) audioBase64 = msg.audioBase64;
  }
  const result: BufferedMessage = { text: texts.join("\n") };
  if (imageBase64) result.imageBase64 = imageBase64;
  if (audioBase64) result.audioBase64 = audioBase64;
  return result;
}

export function createMessageBuffer(opts: {
  waitMs: number;
  now?: () => number;
  onFlush: (batch: BufferedMessage) => void;
}): {
  enqueue: (msg: BufferedMessage) => void;
  flush: () => void;
} {
  const waitMs = opts.waitMs;
  const nowFn = opts.now || (() => Date.now());
  const onFlush = opts.onFlush;
  let queue: BufferedMessage[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  function enqueue(msg: BufferedMessage) {
    queue.push(msg);
    nowFn();
    if (timer) clearTimeout(timer);
    if (!opts.now) {
      timer = setTimeout(flush, waitMs);
    }
  }

  return { enqueue, flush };
}
