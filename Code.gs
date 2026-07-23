/**
 * ============================================================================
 * SISTEM ABSENSI KARYAWAN — PT Duta Makmur Bersama
 * Code.gs — Backend Google Apps Script
 * ============================================================================
 *
 * CARA PASANG (ringkas — lihat PANDUAN-PEMULA.md untuk detail lengkap):
 * 1. Buka Google Spreadsheet Anda.
 * 2. Menu Extensions > Apps Script.
 * 3. Hapus kode contoh, lalu tempel SELURUH isi file ini.
 * 4. Ganti nilai DRIVE_FOLDER_ID di bawah dengan Folder ID Google Drive Anda.
 * 5. Klik Deploy > New deployment > pilih tipe "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Salin URL Web App yang muncul, lalu tempel ke CONFIG.SCRIPT_URL di script.js.
 * ============================================================================
 */

/* ============================================================================
   1. KONFIGURASI
   ============================================================================ */
const CONFIG = {
  // ID folder Google Drive tempat menyimpan foto selfie.
  // Cara mendapatkan: buka folder di Google Drive, salin bagian ID pada URL-nya
  // Contoh URL: https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt
  // ID-nya adalah: 1AbCdEfGhIjKlMnOpQrSt
  DRIVE_FOLDER_ID: "1AbCdEfGhIjKlMnOpQrSt",

  SHEET_ABSEN_MASUK: "Absen Masuk",
  SHEET_ABSEN_IJIN: "Absen Ijin",

  TIMEZONE: "Asia/Jakarta",

  // Kode akses untuk melihat rekap absen (menu "Akses Karu" di website).
  // Ganti kapan saja kalau kode ini perlu diperbarui — tidak perlu ubah
  // apa pun di sisi website, cukup deploy ulang setelah mengganti nilai ini.
  KARU_PASSWORD: "dmbstg"
};

/* ============================================================================
   2. ROUTER UTAMA (doGet / doPost)
   ============================================================================ */

/**
 * doGet — dipanggil saat URL Web App dibuka langsung lewat browser.
 * Berguna untuk memastikan deployment aktif dan berjalan dengan benar.
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: "success",
      message: "Web App Absensi PT Duta Makmur Bersama aktif.",
      serverTime: getServerTime()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * doPost — dipanggil oleh website (script.js) setiap kali karyawan
 * mengirim Absen Masuk atau Absen Ijin.
 */
function doPost(e) {
  let response;
  try {
    const data = JSON.parse(e.postData.contents);

    switch (data.action) {
      case "absenMasuk":
        response = saveAttendance(data);
        break;
      case "absenIjin":
        response = savePermission(data);
        break;
      case "getRekap":
        response = getRekap(data);
        break;
      default:
        response = { status: "error", message: "Aksi tidak dikenali." };
    }
  } catch (err) {
    response = { status: "error", message: "Terjadi kesalahan pada server: " + err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================================
   3. ABSEN MASUK
   ============================================================================ */
function saveAttendance(data) {
  // --- Validasi dasar ---
  if (!data.nama || !data.bagian || !data.shift) {
    return { status: "error", message: "Data tidak lengkap. Nama, Bagian, dan Shift wajib diisi." };
  }
  if (!/^[A-Za-z\s]+$/.test(data.nama)) {
    return { status: "error", message: "Nama tidak boleh mengandung angka atau simbol." };
  }
  if (!data.nomorHp || !/^[0-9+]{9,15}$/.test(data.nomorHp)) {
    return { status: "error", message: "Nomor HP wajib diisi dengan format yang benar (9-15 digit)." };
  }
  if (data.latitude === undefined || data.longitude === undefined) {
    return { status: "error", message: "Lokasi GPS tidak ditemukan." };
  }
  if (!data.fotoBase64) {
    return { status: "error", message: "Foto selfie wajib disertakan." };
  }

  const sheet = getSheet_(CONFIG.SHEET_ABSEN_MASUK);
  const namaBersih = data.nama.trim().toUpperCase();
  const nomorHpBersih = data.nomorHp.trim();

  // --- Cegah absen dua kali dalam satu hari ---
  if (checkDuplicateAttendance(sheet, namaBersih)) {
    return { status: "error", message: "Anda sudah melakukan Absen Masuk hari ini." };
  }

  // --- Unggah foto ke Google Drive (coba ulang otomatis kalau ada gangguan sesaat) ---
  let fotoUrl;
  let uploadError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fotoUrl = uploadPhoto(data.fotoBase64, namaBersih);
      uploadError = null;
      break;
    } catch (err) {
      uploadError = err;
      if (attempt < 3) {
        Utilities.sleep(1000 * attempt); // jeda sebelum mencoba lagi (1 detik, lalu 2 detik)
      }
    }
  }
  if (uploadError) {
    return { status: "error", message: "Gagal mengunggah foto setelah beberapa kali percobaan: " + uploadError.message };
  }

  // --- Timestamp resmi dari server (bukan jam HP) ---
  const now = new Date();
  const jamServer = Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm:ss");
  const tanggalServer = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy");
  const timestampServer = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss");

  sheet.appendRow([
    jamServer,
    tanggalServer,
    namaBersih,
    data.bagian,
    data.shift,
    data.latitude,
    data.longitude,
    data.mapsLink || `https://www.google.com/maps?q=${data.latitude},${data.longitude}`,
    fotoUrl,
    timestampServer,
    nomorHpBersih
  ]);

  return { status: "success", message: "Absen masuk berhasil dicatat.", serverTime: timestampServer };
}

/**
 * checkDuplicateAttendance — mengecek apakah nama karyawan sudah
 * tercatat Absen Masuk pada tanggal hari ini (server).
 */
function checkDuplicateAttendance(sheet, namaBersih) {
  const data = sheet.getDataRange().getValues();
  const tanggalHariIni = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy");

  // Kolom: [0] Jam, [1] Tanggal, [2] Nama, ...
  for (let i = 1; i < data.length; i++) {
    const rowNama = String(data[i][2]).trim().toUpperCase();
    const rowTanggal = formatCellDate_(data[i][1]);
    if (rowNama === namaBersih && rowTanggal === tanggalHariIni) {
      return true;
    }
  }
  return false;
}

/* ============================================================================
   4. ABSEN IJIN
   ============================================================================ */
function savePermission(data) {
  if (!data.nama || !data.bagian || !data.shift || !data.alasan) {
    return { status: "error", message: "Data tidak lengkap. Semua kolom wajib diisi." };
  }
  if (!/^[A-Za-z\s]+$/.test(data.nama)) {
    return { status: "error", message: "Nama tidak boleh mengandung angka atau simbol." };
  }
  if (data.alasan.length > 150) {
    return { status: "error", message: "Alasan maksimal 150 karakter." };
  }

  const sheet = getSheet_(CONFIG.SHEET_ABSEN_IJIN);
  const namaBersih = data.nama.trim().toUpperCase();

  const now = new Date();
  const tanggalServer = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy");
  const timestampServer = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss");

  sheet.appendRow([
    tanggalServer,
    namaBersih,
    data.bagian,
    data.shift,
    data.alasan,
    "INI AKAN DIISI OLEH KARU",
    timestampServer
  ]);

  return { status: "success", message: "Absen ijin berhasil dikirim.", serverTime: timestampServer };
}

/* ============================================================================
   4b. AKSES KARU — REKAP ABSEN (Tanggal > Shift > Bagian > Nama)
   ============================================================================ */
function getRekap(data) {
  if (!data.password || data.password !== CONFIG.KARU_PASSWORD) {
    return { status: "error", message: "Kode akses salah." };
  }

  const sheet = getSheet_(CONFIG.SHEET_ABSEN_MASUK);
  const values = sheet.getDataRange().getValues();
  const rows = [];

  // Urutan kolom: Jam(0) Tanggal(1) Nama(2) Bagian(3) Shift(4)
  //               Latitude(5) Longitude(6) MapsLink(7) LinkFoto(8) Timestamp(9) NomorHp(10)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[2]) continue; // lewati baris kosong

    rows.push({
      jam: formatCellTime_(row[0]),
      tanggal: formatCellDate_(row[1]),
      nama: row[2],
      bagian: row[3],
      shift: row[4],
      fotoUrl: row[8]
    });
  }

  return { status: "success", data: rows };
}

/**
 * formatCellDate_ — menormalkan nilai kolom Tanggal.
 * Google Sheets kadang otomatis mengubah teks tanggal ("dd/MM/yyyy") yang
 * dikirim dari appendRow() menjadi objek Date asli saat disimpan (tergantung
 * pengaturan lokal spreadsheet). Fungsi ini memastikan hasilnya selalu berupa
 * teks "dd/MM/yyyy" yang konsisten, baik saat sel berisi teks maupun Date asli.
 */
function formatCellDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, "dd/MM/yyyy");
  }
  return String(value);
}

/**
 * formatCellTime_ — sama seperti formatCellDate_ tapi untuk kolom Jam.
 * Google Sheets kadang menyimpan nilai waktu sebagai objek Date/Time asli
 * (bukan teks "HH:mm:ss") tergantung pengaturan lokal spreadsheet.
 */
function formatCellTime_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, "HH:mm:ss");
  }
  return String(value);
}

/* ============================================================================
   5. UPLOAD FOTO KE GOOGLE DRIVE
   ============================================================================ */
function uploadPhoto(base64Data, namaBersih) {
  // base64Data berbentuk "data:image/jpeg;base64,......" — buang bagian awalnya.
  const parts = base64Data.split(",");
  const rawBase64 = parts.length > 1 ? parts[1] : parts[0];
  const bytes = Utilities.base64Decode(rawBase64);

  const now = new Date();
  const stamp = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd_HHmmss");
  const fileName = `ABSEN_${namaBersih.replace(/\s+/g, "_")}_${stamp}.jpg`;

  const blob = Utilities.newBlob(bytes, "image/jpeg", fileName);
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const file = folder.createFile(blob);

  // Izinkan file dilihat lewat link (agar dapat ditampilkan di spreadsheet/laporan).
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getUrl();
}

/* ============================================================================
   6. WAKTU SERVER
   ============================================================================ */
function getServerTime() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss");
}

/* ============================================================================
   7. HELPER — AMBIL SHEET & BUAT HEADER OTOMATIS JIKA KOSONG
   ============================================================================ */
function getSheet_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    if (sheetName === CONFIG.SHEET_ABSEN_MASUK) {
      sheet.appendRow([
        "Jam", "Tanggal", "Nama Lengkap", "Bagian", "Shift",
        "Latitude", "Longitude", "Google Maps Link", "Link Foto", "Timestamp Server", "Nomor HP"
      ]);
    } else if (sheetName === CONFIG.SHEET_ABSEN_IJIN) {
      sheet.appendRow([
        "Tanggal", "Nama Lengkap", "Bagian", "Shift", "Alasan", "Approval Karu", "Timestamp Server"
      ]);
    }
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/* ============================================================================
   8. TES AKSES DRIVE (opsional — alat bantu diagnosa)
   ============================================================================
   Jalankan fungsi ini secara manual dari editor Apps Script (pilih namanya di
   dropdown sebelah tombol "Jalankan", lalu klik Jalankan) kalau muncul error
   terkait DriveApp / getFolderById. Hasilnya bisa dilihat di menu
   "Log eksekusi". Fungsi ini aman dibiarkan ada, tidak memengaruhi absensi.
   ============================================================================ */
function testAksesDrive() {
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  Logger.log("Berhasil! Nama folder: " + folder.getName());
}
