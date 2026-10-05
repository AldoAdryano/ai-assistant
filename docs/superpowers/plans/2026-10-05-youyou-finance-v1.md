# Youyou × LIFE OS — Finance Capture v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan pencatatan transaksi keuangan (Expense/Income) dan pelaporan ringkasan via WhatsApp/Telegram dengan integrasi Notion API dan Gemini Tool-Calling.

**Architecture:** Tambahkan konfigurasi `NOTION_FINANCE_DATA_SOURCE_ID`, model tipe `FinanceRecord`, modul integrasi Notion API di `src/notion.ts`, pendaftaran tool Gemini `create_notion_finance` & `read_notion_finance` di `src/gemini.ts`, dan penanganan routing eksekusi serta ringkasan di `src/router.ts`.

**Tech Stack:** TypeScript, Cloudflare Workers, Notion API (2026-03-11), Google Gemini API, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-youyou-finance-v1-design.md`

## Global Constraints

- Verifikasi test dan typecheck dijalankan via `test-docker.sh` (atau `npm test` jika runtime workerd lokal didukung).
- Seluruh penanganan tanggal/waktu harus memperhitungkan zona waktu Indonesia Barat (+07:00 / WIB).
- Nilai `Currency` default `"IDR"` jika tidak diberikan oleh user.
- Fitur tidak boleh crash jika `NOTION_FINANCE_DATA_SOURCE_ID` tidak dikonfigurasi (bersifat gracefully disabled / no-op).

---

### Task 1: Data Types & Configuration

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `FinanceRecord` interface di `src/types.ts`
  - `Env.NOTION_FINANCE_DATA_SOURCE_ID?: string`
  - `AppConfig.notionFinanceDataSourceId: string | null`

- [ ] **Step 1: Tulis test konfigurasi baru di `test/config.test.ts`**

Tambahkan pengujian pembacaan `NOTION_FINANCE_DATA_SOURCE_ID`:
```ts
it("parses optional NOTION_FINANCE_DATA_SOURCE_ID correctly", () => {
  const envWithFinance: Env = {
    ...baseEnv,
    NOTION_FINANCE_DATA_SOURCE_ID: "finance-ds-123",
  };
  const config = getConfig(envWithFinance);
  expect(config.notionFinanceDataSourceId).toBe("finance-ds-123");

  const envWithoutFinance: Env = {
    ...baseEnv,
    NOTION_FINANCE_DATA_SOURCE_ID: "   ",
  };
  expect(getConfig(envWithoutFinance).notionFinanceDataSourceId).toBeNull();
});
```

- [ ] **Step 2: Jalankan test untuk memverifikasi kegagalan**

Run: `sg docker -c "bash test-docker.sh"`
Expected: FAIL dengan error tipe missing property `notionFinanceDataSourceId`.

- [ ] **Step 3: Update `src/types.ts` dan `src/config.ts`**

Di `src/types.ts`:
```ts
export interface FinanceRecord {
  id: string;
  name: string;
  amount: number;
  currency: string;
  type: "Expense" | "Income";
  category: string;
  date: string;
  notes?: string | null;
}
```
Tambahkan `NOTION_FINANCE_DATA_SOURCE_ID?: string;` ke `interface Env`.
Tambahkan `notionFinanceDataSourceId: string | null;` ke `interface AppConfig`.

Di `src/config.ts`:
```ts
notionFinanceDataSourceId:
  typeof env.NOTION_FINANCE_DATA_SOURCE_ID === "string" && env.NOTION_FINANCE_DATA_SOURCE_ID.trim() !== ""
    ? env.NOTION_FINANCE_DATA_SOURCE_ID.trim()
    : null,
```

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `sg docker -c "bash test-docker.sh"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat: add FinanceRecord types and configuration binding"
```

---

### Task 2: Notion API Client for Finance

**Files:**
- Modify: `src/notion.ts`
- Create: `test/notion-finance.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `FinanceRecord`
- Produces:
  - `createFinanceRecord(config: AppConfig, payload: Omit<FinanceRecord, "id">, customFetch?: typeof fetch): Promise<FinanceRecord>`
  - `listFinanceRecords(config: AppConfig, filter?: { startDate?: string; endDate?: string; type?: "Expense" | "Income" | "All"; category?: string }, customFetch?: typeof fetch): Promise<FinanceRecord[]>`

- [ ] **Step 1: Tulis unit test di `test/notion-finance.test.ts`**

Buat pengujian `createFinanceRecord` dan `listFinanceRecords`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createFinanceRecord, listFinanceRecords } from "../src/notion";
import type { AppConfig } from "../src/types";

const mockConfig = {
  notionApiKey: "secret-key",
  notionVersion: "2026-03-11",
  notionFinanceDataSourceId: "ds-finance-1",
} as AppConfig;

describe("Notion Finance API", () => {
  it("creates a finance expense record with correct payload", async () => {
    let capturedBody: any = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: "page-123",
        properties: {
          Name: { title: [{ plain_text: "Makan Siang" }] },
          Amount: { number: 25000 },
          Currency: { select: { name: "IDR" } },
          Type: { select: { name: "Expense" } },
          Category: { select: { name: "Food" } },
          Date: { date: { start: "2026-10-05T12:30:00+07:00" } },
          Notes: { rich_text: [{ plain_text: "Kenyang" }] },
        }
      }), { status: 200 });
    };

    const res = await createFinanceRecord(mockConfig, {
      name: "Makan Siang",
      amount: 25000,
      currency: "IDR",
      type: "Expense",
      category: "Food",
      date: "2026-10-05T12:30:00+07:00",
      notes: "Kenyang",
    }, fakeFetch);

    expect(capturedBody.parent.data_source_id).toBe("ds-finance-1");
    expect(capturedBody.properties.Amount.number).toBe(25000);
    expect(capturedBody.properties.Type.select.name).toBe("Expense");
    expect(res.id).toBe("page-123");
  });

  it("lists and filters finance records", async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({
        results: [
          {
            id: "page-1",
            properties: {
              Name: { title: [{ plain_text: "Project Bonus" }] },
              Amount: { number: 1000000 },
              Currency: { select: { name: "IDR" } },
              Type: { select: { name: "Income" } },
              Category: { select: { name: "Client/Project" } },
              Date: { date: { start: "2026-10-05T10:00:00+07:00" } },
            }
          }
        ]
      }), { status: 200 });
    };

    const list = await listFinanceRecords(mockConfig, { type: "Income" }, fakeFetch);
    expect(list.length).toBe(1);
    expect(list[0].amount).toBe(1000000);
    expect(list[0].type).toBe("Income");
  });
});
```

- [ ] **Step 2: Jalankan test untuk memverifikasi kegagalan**

Run: `sg docker -c "bash test-docker.sh"`
Expected: FAIL dengan error fungsi `createFinanceRecord` & `listFinanceRecords` belum terdefinisi.

- [ ] **Step 3: Implementasikan fungsi di `src/notion.ts`**

Tambahkan implementasi pembentukan payload Notion API `2026-03-11` untuk `createFinanceRecord` dan query filter di `listFinanceRecords`.

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `sg docker -c "bash test-docker.sh"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/notion.ts test/notion-finance.test.ts
git commit -m "feat: implement createFinanceRecord and listFinanceRecords in Notion client"
```

---

### Task 3: Gemini Tool Definitions & Declarations

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts`

**Interfaces:**
- Produces:
  - Tool declaration `create_notion_finance`
  - Tool declaration `read_notion_finance`

- [ ] **Step 1: Tambahkan test skema tool di `test/gemini.test.ts`**

Verifikasi bahwa skema tool memuat property required: `name`, `amount`, `type`, `category`.

- [ ] **Step 2: Jalankan test untuk memverifikasi kegagalan**

Run: `sg docker -c "bash test-docker.sh"`
Expected: FAIL

- [ ] **Step 3: Definisikan tool declarations di `src/gemini.ts`**

Daftarkan parameter JSON Schema untuk:
- `create_notion_finance`
- `read_notion_finance`

- [ ] **Step 4: Jalankan test**

Run: `sg docker -c "bash test-docker.sh"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/gemini.ts test/gemini.test.ts
git commit -m "feat: add Gemini tool definitions for create and read finance"
```

---

### Task 4: Router Integration & Summary Formatter

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Interfaces:**
- Consumes: `createFinanceRecord`, `listFinanceRecords`, `create_notion_finance`, `read_notion_finance`
- Produces: Penanganan pesan pengguna terkait finance dan respon ringkasan WhatsApp.

- [ ] **Step 1: Tulis test alur router di `test/router.test.ts`**

Uji dua skenario:
1. Tool call `create_notion_finance` berhasil menghasilkan pesan konfirmasi dengan format rapi.
2. Tool call `read_notion_finance` mengambil daftar transaksi dan menyusun ringkasan (Total Pengeluaran, Total Pemasukan, dan breakdown kategori).

- [ ] **Step 2: Jalankan test untuk memverifikasi kegagalan**

Run: `sg docker -c "bash test-docker.sh"`
Expected: FAIL

- [ ] **Step 3: Implementasikan routing di `src/router.ts`**

- Baca `financeEnabled = Boolean(config.notionFinanceDataSourceId)`.
- Jika enabled, sertakan tool finance ke Gemini interaction.
- Handle call `create_notion_finance`: Panggil `createFinanceRecord`, kembalikan feedback konfirmasi.
- Handle call `read_notion_finance`: Panggil `listFinanceRecords`, kalkulasi agregat ringkasan dan format balasan.

- [ ] **Step 4: Jalankan full test suite dan typecheck**

Run: `sg docker -c "bash test-docker.sh"`
Expected: PASS (seluruh test suite hijau)

- [ ] **Step 5: Commit**

```bash
git add src/router.ts test/router.test.ts
git commit -m "feat: wire finance tools into message router and summary formatter"
```

---

### Task 5: End-to-End Verification & Documentation Update

**Files:**
- Modify: `docs/superpowers/plans/2026-09-20-youyou-life-os-roadmap.md`
- Test: Full Vitest suite

- [ ] **Step 1: Jalankan verifikasi total**

Run: `sg docker -c "bash test-docker.sh"`
Expected: Exit 0, semua test lulus tanpa error.

- [ ] **Step 2: Update status roadmap LIFE OS**

Tandai Fase 4 (Finance Capture v1) sebagai selesai / in-progress di `docs/superpowers/plans/2026-09-20-youyou-life-os-roadmap.md`.

- [ ] **Step 3: Commit dokumentasi**

```bash
git add docs/superpowers/plans/2026-09-20-youyou-life-os-roadmap.md
git commit -m "docs: update LIFE OS roadmap for Finance Capture v1"
```
