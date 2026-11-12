# Drilling Mastery 100

Situs latihan operasi pengeboran: sesi utama **tepat 100 soal unik**, dengan
proporsi per materi, urutan soal, dan pilihan jawaban yang berubah pada setiap
sesi baru. Situs tetap statis, tanpa backend, API key, atau proses build.

## Paket materi

| Paket | Materi | Soal siap latihan | Proporsi sesi 100 soal |
| --- | ---: | ---: | --- |
| Lanjutan (default, ZIP 12 November 2026) | 18 | 263 | 5 soal/materi + 1 untuk 10 materi acak |
| Dasar (paket sebelumnya) | 18 | 274 | 5 soal/materi + 1 untuk 10 materi acak |
| Gabungan | 36 | 537 | 2 soal/materi + 1 untuk 28 materi acak |

ZIP sumber sebenarnya memuat **275 soal**. Quiz 28 nomor 19 mengenai perbandingan
anggaran ditandai `reviewRequired` dan tidak dinilai karena konteks angka tidak
cukup untuk mendukung kunci False. Merek/model produk, sponsor, sejarah organisasi, spesifikasi unit tertentu,
pencapaian, promosi, serta hafalan angka/kejadian studi kasus tidak diujikan.
Sebanyak 27 soal sumber ditandai `excluded` (6 dasar dan 21 lanjutan).
Paket lanjutan menambahkan 10 soal konsep umum cost engineering agar proporsi
materi tetap terpenuhi. Soal tambahan ditandai `sourceKind: concept-extension`;
soal ini tidak diklaim sebagai kutipan/kunci dari PDF.
Metadata file PDF, halaman, dan nomor soal tersimpan pada paket lanjutan.
PDF asli tidak disertakan dalam situs yang diterbitkan.

## Cara belajar

1. Pilih paket, lalu mulai 100 soal. Soal di luar sesi sebelumnya diprioritaskan;
   sebagian soal boleh muncul kembali bila diperlukan untuk memenuhi proporsi.
2. Jawab dan pilih tingkat keyakinan. Setelah diperiksa, jawaban dikunci dan
   pembahasan ditampilkan. Ada catatan opsional untuk menjelaskan alasan sendiri.
3. Selesaikan semua soal untuk melihat skor, nilai per materi, dan review.
4. Latihan ulang memuat soal salah atau benar tetapi masih ragu, tanpa membuka
   kunci terlebih dulu. Dua jawaban benar dan yakin berturut-turut mengeluarkan
   soal dari antrean; ini indikator latihan, bukan jaminan penguasaan.

Latihan ulang mengikuti jumlah soal dalam antrean; sesi utama selalu 100.
Progres, pilihan yang belum dikirim, keyakinan, catatan, dan statistik tersimpan
di `localStorage` browser perangkat ini. Penyimpanan tidak tersinkron antardevice.
Mode privat, penghapusan data browser, atau perubahan domain dapat menghilangkan
akses ke progres. Kegagalan penyimpanan ditampilkan pada halaman.
Sesi dan statistik `v1` paket dasar dipertahankan melalui migrasi ke `v2`.
Jika sesi aktif lama memuat soal yang dikeluarkan, soal diganti dengan konsep
lain dalam materi yang sama. Jumlah 100 dan proporsinya tetap, sementara jawaban
dan catatan soal lain dipertahankan. Antrean ulang lama juga disaring. Hasil sesi
yang sudah selesai tetap menjadi riwayat; soal yang dikeluarkan tidak muncul
dalam review jawaban atau latihan baru.

## Jalankan lokal

Python 3 sudah cukup. Dari direktori **induk** checkout:

```sh
cd /workspace
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace
```

Untuk pemeriksaan internal, request path `/drilling-mastery-100/` pada server.
Halaman utama memakai path aset relatif dan juga dapat disajikan dari root
checkout. `404.html` mempertahankan base path GitHub Pages repositori ini.
Workflow `.github/workflows/pages.yml` menerbitkan file statis ketika perubahan
di-push ke `main`; perubahan lokal belum mengubah website publik.

## Validasi

```sh
cd /workspace/drilling-mastery-100
node --test tests/quiz-engine.test.mjs
node tests/browser-smoke.cjs
```

Pengujian engine memakai Node bawaan, termasuk 1.500 sesi untuk memeriksa kuota,
keunikan soal, variasi sesi, penilaian semua tipe soal, antrean ulang, dan validasi
progres tersimpan. Browser smoke test memerlukan Playwright dan Chromium
(`/usr/bin/chromium` tersedia di cloud environment), serta server lokal di atas.
`DRILLING_TEST_URL` dan `CHROMIUM_PATH` dapat dipakai untuk mengubah target.
Browser test menyelesaikan 100 soal lewat UI, memeriksa skor dan pemulihan sesi,
menyelesaikan dua putaran latihan ulang, menguji semua jenis input, tampilan HP,
kegagalan storage, dan migrasi sesi lama. Ini bukan pengganti pemeriksaan pakar
atas seluruh kunci materi.

## Struktur yang dapat diedit

- `assets/app.mjs`: antarmuka, penyimpanan browser, navigasi, dan migrasi progres.
- `assets/quiz-engine.mjs`: sampling, pengacakan, penilaian, dan aturan latihan.
- `assets/learning.css`: tambahan gaya pada desain website yang sudah ada.
- `data/foundation.json`: bank dan modul belajar paket dasar yang dipertahankan.
- `data/advanced.json`: soal PDF baru, kunci, konteks, sumber, dan catatan editorial.
- `data/advanced-lessons.json`: ringkasan konsep yang terhubung ke soal.
- `media/advanced-*.webp`: gambar dari PDF yang diperlukan soal; dioptimalkan untuk web.

Bundle lama dipertahankan sebagai arsip; entrypoint aktif adalah `assets/app.mjs`.
Tidak perlu mengedit bundle minified untuk memperbarui soal atau logika.

Untuk impor ulang PDF, gunakan Python dengan PyMuPDF dan Pillow, lalu jalankan:

```sh
python scripts/import-kahoot.py /path/to/pdfs --output /tmp/advanced-reimport.json
```

Bandingkan hasil dan periksa kunci sebelum mengganti data aktif. Importer membaca
teks/penanda jawaban dan mempertahankan koreksi editorial yang sumber aslinya
masih cocok. Perubahan teks sumber pada soal yang dikoreksi akan menghentikan
impor untuk ditinjau. Kebijakan pengecualian dan soal konsep tambahan juga
dipertahankan ketika impor ulang. Gambar WebP yang sudah ada dipakai kembali. Dokumen hanya
dipakai sebagai materi, tidak pernah dijalankan sebagai instruksi atau kode.
