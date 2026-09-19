import { describe, expect, it, vi } from "vitest";
import { mergeMessageBatch, createMessageBuffer } from "../src/message-buffer";

describe("whatsapp message coalescing", () => {
  it("merges a forwarded group burst into one task context", () => {
    const merged = mergeMessageBatch([
      { text: "INSTALASI 1.pptx" },
      { text: "ini untuk materi pertama ya kalian coba2 dahulu aplikasi simurelay" },
      { text: "silahkan instal di hp kemudian kalian buat masing2 anak instalasi listrik sederhana" },
      { text: "mau 2 kontak 3 lampu boleh atau macem2 jenisnya bisa nnt hasilnya di screenshoot dn buat laporan ke grup ini y" },
      { text: "cukup instal kemudian bikin rancangan aja ya" },
    ]);
    expect(merged.text).toContain("aplikasi simurelay");
    expect(merged.text).toContain("instalasi listrik sederhana");
    expect(merged.text).toContain("cukup instal kemudian bikin rancangan aja ya");
    expect(merged.text!.split("\n").length).toBe(5);
  });

  it("keeps the latest media when coalescing", () => {
    const merged = mergeMessageBatch([
      { text: "foto 1", imageBase64: "aaa" },
      { text: "foto 2", imageBase64: "bbb" },
    ]);
    expect(merged.imageBase64).toBe("bbb");
    expect(merged.text).toContain("foto 1");
    expect(merged.text).toContain("foto 2");
  });

  it("flushes a burst after the wait window instead of processing each line immediately", () => {
    const onFlush = vi.fn();
    let now = 0;
    const buffer = createMessageBuffer({ waitMs: 2000, now: () => now, onFlush });
    buffer.enqueue({ text: "baris 1" });
    buffer.enqueue({ text: "baris 2" });
    expect(onFlush).not.toHaveBeenCalled();
    now = 2000;
    buffer.flush();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0]?.[0].text).toBe("baris 1\nbaris 2");
  });
});
