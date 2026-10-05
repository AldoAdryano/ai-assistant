# Youyou × LIFE OS — Finance Capture v1 Design

**Goal:** Menambahkan pencatatan dan analisis transaksi keuangan (Expense & Income) berbasis DM WhatsApp ke dalam Youyou (LIFE OS) dengan penyimpanan di Notion Data Source.

---

## 1. Scope & Architecture

### Key Requirements
- User bisa mencatat pengeluaran (*Expense*) atau pemasukan (*Income*) secara alami via WhatsApp (contoh: *"makan nasi padang 15rb"*, *"dapat transfer 2.5jt dari client A"*, *"bayar listrik 150k kemarin jam 10 malam"*).
- Bot mendeteksi nominal, mata uang (default `IDR`), jenis (`Expense`/`Income`), kategori (`Food`, `Transport`, `Bills`, `Shopping`, `Client/Project`, `Other`), serta waktu spesifik (Date + Time WIB +07:00).
- User bisa meminta ringkasan atau query transaksi keuangan (contoh: *"berapa pengeluaran minggu ini?"*, *"ringkas pemasukan bulan ini"*).
- Fitur bersifat opsional dan diaktifkan bila `NOTION_FINANCE_DATA_SOURCE_ID` diisi pada binding/environment Worker.

### Architecture Overview
```text
WhatsApp / Telegram Message
           ↓
    Cloudflare Worker (src/index.ts)
           ↓
     src/router.ts (handleUserMessage)
           ↓
  Gemini 3.5 Flash / Interactions API (src/gemini.ts)
     ├── Tool: create_notion_finance
     └── Tool: read_notion_finance
           ↓
  Notion Client (src/notion.ts) ──POST/GET──> Notion API (2026-03-11)
                                                 └── Database: Finance
```

---

## 2. Notion Data Source Schema

Nama Database: **Finance**
ID Source: `NOTION_FINANCE_DATA_SOURCE_ID`

| Property Name | Notion Property Type | Values / Format | Keterangan |
|---------------|----------------------|-----------------|------------|
| **Name** | Title | Text | Nama/deskripsi singkat transaksi (mis. *"Makan Nasi Padang"*) |
| **Amount** | Number | Numeric (15000, 2500000) | Nominal murni tanpa simbol mata uang |
| **Currency** | Select | `IDR`, `USD`, `EUR`, `SGD`, etc. | Default `IDR` jika tidak disebutkan |
| **Type** | Select | `Expense`, `Income` | Jenis transaksi |
| **Category** | Select | `Food`, `Transport`, `Bills`, `Shopping`, `Client/Project`, `Other` | Kategori transaksi |
| **Date** | Date | ISO DateTime dengan timezone (`YYYY-MM-DDTHH:mm:ss+07:00`) | Waktu transaksi. Jika pengguna tidak menyebut jam, pakai waktu pesan saat ini (WIB). |
| **Notes** | Rich Text | Text | (Opsional) Catatan tambahan atau konteks detail |

---

## 3. Gemini Tool-Calling Interfaces

### 3.1. `create_notion_finance`
Digunakan saat user mencatat transaksi baru.

**Parameters:**
- `name` (string, required): Deskripsi singkat transaksi.
- `amount` (number, required): Nominal angka positif (mis. `15000`).
- `type` (string, required, enum: `["Expense", "Income"]`): Jenis transaksi.
- `category` (string, required, enum: `["Food", "Transport", "Bills", "Shopping", "Client/Project", "Other"]`): Kategori.
- `currency` (string, optional): Default `"IDR"`.
- `date` (string, optional): Format ISO DateTime +07:00 (mis. `2026-10-05T14:30:00+07:00`).
- `notes` (string, optional): Catatan tambahan.

### 3.2. `read_notion_finance`
Digunakan saat user menanyakan riwayat/ringkasan keuangan.

**Parameters:**
- `startDate` (string, optional): ISO Date (`YYYY-MM-DD`).
- `endDate` (string, optional): ISO Date (`YYYY-MM-DD`).
- `type` (string, optional, enum: `["Expense", "Income", "All"]`): Default `"All"`.
- `category` (string, optional): Filter kategori tertentu.

---

## 4. System Integration & Code Map

### Data Structures (`src/types.ts`)
- Tambah `NOTION_FINANCE_DATA_SOURCE_ID?: string` di `Env` interface.
- Tambah `notionFinanceDataSourceId: string | null` di `AppConfig`.
- Definisikan interface `FinanceRecord`:
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

### Configuration (`src/config.ts`)
- Baca `env.NOTION_FINANCE_DATA_SOURCE_ID` secara aman (null jika kosong/undefined).

### Notion Client (`src/notion.ts`)
- Tambah `createFinanceRecord(config: AppConfig, payload: ..., customFetch?: typeof fetch)`
- Tambah `listFinanceRecords(config: AppConfig, filter?: ..., customFetch?: typeof fetch)`

### Router (`src/router.ts`)
- Deklarasikan flag `financeEnabled = Boolean(config.notionFinanceDataSourceId)`.
- Jika `financeEnabled` true: daftarkan tool declaration `create_notion_finance` dan `read_notion_finance` ke Gemini.
- Tangani panggilan tool di `handleUserMessage`:
  - `create_notion_finance`: Panggil `createFinanceRecord`, format pesan sukses (mis: *"✅ Catatan keuangan disimpan: [Expense] Makan Nasi Padang — Rp15.000 (05 Oct 2026, 14:30 WIB)"*).
  - `read_notion_finance`: Panggil `listFinanceRecords`, kalkulasi total Expense, total Income, dan breakdown per kategori, lalu serahkan ke Gemini/format balasan ringkasan yang rapi.

---

## 5. Testing Plan

- **`test/config.test.ts`**: Verifikasi parsing `NOTION_FINANCE_DATA_SOURCE_ID`.
- **`test/notion-finance.test.ts`**: Test terpisah untuk `createFinanceRecord` dan `listFinanceRecords` dengan mock fetch (memverifikasi struktur payload JSON ke Notion API).
- **`test/gemini.test.ts`**: Test skema tool Gemini `create_notion_finance` & `read_notion_finance`.
- **`test/router.test.ts`**: Test end-to-end routing untuk pencatatan transaksi & query ringkasan keuangan.
