# Youyou × LIFE OS — Task Planner v1 Design

**Goal:** Youyou menerima satu tujuan di chat pribadi, menyusun rencana tugas, menunggu satu jawaban "ya", lalu menulis hanya ke database Tasks.

Dua tujuan yang didukung:

- Mengatur tugas yang sudah ada untuk minggu ini.
- Belajar sesuatu dalam N hari, dengan tugas baru yang tersebar di jendela hari itu.

---

## 1. Scope

### Yang masuk

- Chat pribadi WhatsApp dan Telegram.
- Gemini dipanggil sekali untuk menyusun rencana lewat tool `propose_task_plan`.
- Operasi yang lolos validasi disimpan di KV. Jawaban "ya" menjalankan daftar itu tanpa memanggil Gemini lagi.
- "jangan" membuang rencana tanpa menulis ke Notion.
- Tulisan Notion hanya `createTask` dan `updateTask`.

### Yang tidak masuk

- Menulis Goals, Learning, Finance, Inbox, atau Memory.
- Loop evaluasi yang menyusun ulang rencana sendiri.
- Web search, filesystem, GitHub, atau agent lain.
- Chat grup. Tool planner tidak didaftarkan di grup, dan panggilan yang lolos tetap ditolak.
- Mengubah tugas berstatus Done.
- Membuat tugas pada skenario minggu ini, atau mengubah tugas lama pada skenario belajar.

---

## 2. Alur

```text
Pesan DM
   ↓
Ada hapus yang masih menunggu konfirmasi?
   ├─ Ya → alur hapus yang sudah ada. Rencana tidak dimulai.
   └─ Tidak
         ↓
Ada rencana segar, dan pesan ini "ya" atau "jangan"?
   ├─ "jangan" → hapus KV, tidak ada tulisan Notion
   ├─ "ya" → jalankan operasi tersimpan
   └─ bukan keduanya → rencana tetap di KV
         ↓
Gemini (sekali) → propose_task_plan
   ↓
Router memvalidasi operasi
   ├─ tidak ada yang lolos → jelaskan alasannya, jangan simpan
   └─ ada yang lolos → simpan KV, tampilkan daftar, tanya "ya" / "jangan"
```

Rencana diganti kalau pengguna meminta rencana baru yang lolos validasi. Rencana yang usianya lebih dari 30 menit diabaikan dan dihapus dari KV. Pesan setelah itu diproses sebagai chat biasa.

Selama rencana masih segar, Gemini tidak boleh membuat atau mengubah tugas lewat `create_notion_task` dan `update_notion_task`. Youyou mengingatkan bahwa rencana yang tertunda menunggu "ya" atau "jangan".

Konfirmasi memakai frase yang sama dengan hapus: "ya", "iya", "iyaa serius", dan "jangan".

---

## 3. Data di KV

Kunci baru: `pending_task_plan:{userId}`. Jangan memakai `pending_task:`, karena kunci itu sudah untuk klarifikasi satu tugas.

TTL KV mengikuti pola pending lain (3600 detik). Kesegaran yang dipakai router adalah 30 menit dari `createdAt`.

```ts
type PlanPriority = "Low" | "Medium" | "High";

type StoredPlanOp =
  | { op: "update"; taskId: string; title: string; due_date: string; priority?: PlanPriority }
  | { op: "create"; title: string; due_date: string; priority: PlanPriority };

type PendingTaskPlan = {
  kind: "week" | "learn";
  ops: StoredPlanOp[];
  createdAt: number;
};
```

`due_date` yang disimpan berformat `YYYY-MM-DD` di kalender WIB. `title` pada operasi update disalin dari tugas aktif yang cocok, bukan dari teks model.

---

## 4. Tool Gemini

`propose_task_plan`

Parameter:

- `kind`: `"week"` atau `"learn"`.
- `ops`: daftar operasi.
  - Update: `taskId`, `due_date`, `priority` opsional.
  - Create: `title`, `due_date`, `priority` opsional.

Router yang menentukan jendela tanggal dan jumlah hari dari teks pengguna serta waktu WIB sekarang. Angka hari dari model tidak dipakai kalau tidak ada di pesan pengguna.

---

## 5. Skenario minggu ini

Sumber tugas: `listActiveTasks` (To Do dan Doing).

Setiap operasi update wajib punya `taskId` yang ada di daftar itu. Tenggat wajib jatuh pada Senin–Minggu minggu WIB berjalan (`currentWibWeekRange`). Prioritas pada update hanya dipertahankan kalau pesan pengguna memuat kata prioritas: low, medium, high, rendah, sedang, atau tinggi. Kalau tidak, field itu dibuang.

Operasi create pada kind `week` dibuang. Id yang tidak dikenal dan tanggal di luar minggu ini dibuang. Kalau tidak ada tugas aktif, atau tidak ada operasi yang tersisa, jangan simpan rencana. Balasan menjelaskan alasannya.

---

## 6. Skenario belajar dalam N hari

N adalah bilangan yang berdiri langsung sebelum kata "hari". Kalau ada lebih dari satu, yang dipakai adalah yang terakhir. Contoh yang lolos: "belajar ROS dalam 30 hari", "belajar MQTT 14 hari". Nilai yang dipakai harus 1–90. Kalau tidak ada, atau di luar rentang itu, Youyou bertanya jumlah harinya dan tidak menyimpan rencana.

Jendela tanggal inklusif: hari ini WIB sampai hari ini + (N − 1). Prompt Gemini meminta tanggal tersebar di jendela itu. Router hanya menolak tanggal di luar jendela, dan tidak mengatur ulang tanggal yang dikirim model.

Operasi yang disimpan hanya create. Update dibuang. Prioritas yang tidak disebut pengguna menjadi `Medium`. Judul yang sama dengan tugas aktif, setelah trim dan tanpa memedulikan kapital, dilewati.

Paling banyak 8 create yang lolos. Kalau model mengirim lebih banyak, 8 pertama yang valid disimpan, dan balasan menyebut bahwa sisanya dipotong. Kalau setelah penyaringan tidak ada create yang tersisa, jangan simpan rencana.

---

## 7. Balasan

Rencana yang tersimpan dibalas sebagai daftar bernomor: nama tugas dan tenggat baru. Pada minggu ini, sertakan tenggat lama bila ada. Tutup dengan permintaan "ya" atau "jangan".

Kalau daftar belajar dipotong di 8, satu kalimat menyatakan berapa usulan yang tidak masuk. Kalau ada judul yang dilewati karena sudah ada, sebut judul itu.

Setelah "ya":

- Operasi dijalankan berurutan.
- Kegagalan satu operasi tidak menghentikan operasi berikutnya.
- Balasan menyebut jumlah berhasil dan judul yang gagal.
- Kalau semua gagal, rencana tetap di KV supaya "ya" berikutnya mencoba lagi.
- Kalau minimal satu berhasil, rencana dihapus dari KV supaya tugas yang sudah tertulis tidak ditulis lagi.

Setelah "jangan": KV dihapus, dan balasan menyatakan tidak ada yang ditulis.

---

## 8. Penempatan kode

| Unit | Peran |
|---|---|
| `src/task-plan.ts` | Tipe, validasi, format balasan, aturan N dan jendela minggu |
| `src/state.ts` | Simpan, baca, dan hapus `pending_task_plan` |
| `src/gemini.ts` | Tool `propose_task_plan` dan aturan singkat di prompt DM |
| `src/router.ts` | Urutan konfirmasi, tolak tulis tugas saat rencana tertunda, panggil apply |
| `src/notion.ts` | Tetap memakai `createTask` dan `updateTask` yang sudah ada |

`task-plan.ts` tidak memanggil Notion dan tidak membaca KV. Router yang menghubungkan daftar tugas aktif, KV, dan klien Notion. Dengan begitu validasi bisa dites tanpa jaringan.

---

## 9. Tes

- Usulan minggu ini menyimpan rencana dan tidak memanggil `updateTask`.
- "ya" memanggil `updateTask` untuk setiap operasi, lalu menghapus rencana.
- "jangan" menghapus rencana dan tidak menulis Notion.
- Id palsu dan tanggal di luar minggu ini tidak masuk rencana.
- Tidak ada tugas aktif: tidak ada rencana tersimpan.
- Belajar memanggil `createTask` saat "ya", dan tidak memanggil `updateTask`.
- Lebih dari 8 create dipotong menjadi 8, dan balasan menyebut pemotongan.
- Judul yang sudah ada dilewati.
- N hilang atau di luar 1–90: tidak ada rencana, balasan meminta jumlah hari.
- Chat grup tidak mendapat tool ini.
- Semua operasi gagal: rencana tetap ada.
- Sebagian berhasil: rencana dihapus, judul yang gagal disebut.
- Rencana berusia lebih dari 30 menit tidak dijalankan.
- Hapus yang masih menunggu konfirmasi didahulukan, dan rencana tidak dimulai.
- Selama rencana segar, `create_notion_task` dan `update_notion_task` dari Gemini tidak menulis Notion.
