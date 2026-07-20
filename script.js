/* ==========================================================================
   SISTEM ABSENSI KARYAWAN — PT Duta Makmur Bersama
   script.js
   ========================================================================== */

/* ======================================================================
   1. KONFIGURASI — UBAH BAGIAN INI SESUAI KEBUTUHAN ANDA
   ====================================================================== */
const CONFIG = {
  // Tempel URL Web App Google Apps Script Anda di sini setelah deploy.
  // Panduan lengkap ada di file PANDUAN-PEMULA.md
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwP82DNrZaJnkcQ1SO2bcegXD4YMCEP72QlT-5EN8gAEV9Spy7jo-ivOeWlzxmjYd2WBw/exec",

  // Koordinat lokasi kantor / pabrik: PT Sentralindo Teguh Gemilang 2
  // Jl. Raya Fatahillah No.35, Kalijaya, Kec. Cikarang Bar., Kab. Bekasi, Jawa Barat 17530
  officeLat: -6.2635782,
  officeLng: 107.1338868,

  // Radius absen yang diizinkan, dalam meter.
  radiusMeters: 250,

  // Kualitas kompresi foto selfie (0.1 - 1.0) dan lebar maksimal (px).
  // Nilai ini sudah diatur agar ukuran file kecil (biasanya di bawah 100 KB)
  // sehingga karyawan tidak perlu menunggu lama saat mengirim absen,
  // namun wajah dan seragam tetap terlihat jelas untuk verifikasi.
  photoQuality: 0.55,
  photoMaxWidth: 480
};

/* ======================================================================
   2. STATE APLIKASI
   ====================================================================== */
const state = {
  masuk: {
    lokasi: null,       // { lat, lng, distance, mapsLink }
    fotoBase64: null,
    stream: null
  },
  deferredInstallPrompt: null
};

/* ======================================================================
   3. HELPERS
   ====================================================================== */
const $ = (id) => document.getElementById(id);

function pad(n){ return n.toString().padStart(2, "0"); }

function formatJam(d){
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTanggal(d){
  return d.toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function onlyLetters(str){
  return /^[A-Za-z\s]*$/.test(str);
}

function showAlert(icon, title, text){
  if (window.Swal){
    return Swal.fire({ icon, title, text, confirmButtonColor: "#1D4ED8" });
  }
  alert(`${title}\n${text || ""}`);
}

function toggleLoading(show, text){
  $("loading-overlay").hidden = !show;
  if (text) $("loading-text").textContent = text;
}

/* ======================================================================
   4. JAM & TANGGAL REALTIME
   ====================================================================== */
function tickClock(){
  const now = new Date();
  const jam = formatJam(now);
  const tanggal = formatTanggal(now);

  $("clock-mini").textContent = jam;
  $("clock-main").textContent = jam;
  $("date-main").textContent = tanggal;
  if ($("masuk-jam")) $("masuk-jam").value = jam;
  if ($("masuk-tanggal")) $("masuk-tanggal").value = tanggal;
  if ($("ijin-tanggal")) $("ijin-tanggal").value = tanggal;
}
setInterval(tickClock, 1000);
tickClock();
$("year").textContent = new Date().getFullYear();

/* ======================================================================
   5. NAVIGASI ANTAR HALAMAN
   ====================================================================== */
function showView(id){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("view--active"));
  $(id).classList.add("view--active");
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (id !== "view-masuk"){
    stopCamera();
  }
  if (id === "view-home"){
    resetMasukForm();
    resetIjinForm();
  }
}

document.querySelectorAll("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.nav));
});

/* ======================================================================
   6. VALIDASI NAMA (UPPERCASE OTOMATIS, HANYA HURUF)
   ====================================================================== */
function bindNameField(inputId, errorId){
  const input = $(inputId);
  const error = $(errorId);
  input.addEventListener("input", () => {
    const cursorPos = input.selectionStart;
    const raw = input.value;
    const cleaned = raw.replace(/[^A-Za-z\s]/g, "");
    const upper = cleaned.toUpperCase();
    if (raw !== upper){
      input.value = upper;
      input.setSelectionRange(cursorPos, cursorPos);
    }
    error.textContent = cleaned.trim().length === 0 && raw.length > 0
      ? "Nama tidak boleh mengandung angka atau simbol."
      : "";
  });
}
bindNameField("masuk-nama", "masuk-nama-error");
bindNameField("ijin-nama", "ijin-nama-error");

/* ======================================================================
   7. ABSEN MASUK — STEP 1: DATA DIRI
   ====================================================================== */
function resetMasukForm(){
  $("masuk-nama").value = "";
  $("masuk-bagian").selectedIndex = 0;
  $("masuk-shift").selectedIndex = 0;
  $("masuk-nama-error").textContent = "";
  state.masuk.lokasi = null;
  state.masuk.fotoBase64 = null;

  $("masuk-step-1").classList.remove("step--hidden");
  $("masuk-step-2").classList.add("step--hidden");
  $("masuk-step-3").classList.add("step--hidden");
  $("masuk-progress").textContent = "Langkah 1 dari 3 — Data Diri";

  $("gps-result").hidden = true;
  $("gps-illustration").className = "gps-illustration";
  $("masuk-to-step3").disabled = true;

  $("selfie-preview").hidden = true;
  $("selfie-video").hidden = false;
  $("selfie-actions-camera").hidden = false;
  $("selfie-actions-shoot").hidden = true;
  $("selfie-actions-retake").hidden = true;
  $("btn-kirim-absen").disabled = true;
}

function validasiStep1(){
  const nama = $("masuk-nama").value.trim();
  const bagian = $("masuk-bagian").value;
  const shift = $("masuk-shift").value;

  if (!nama || !onlyLetters(nama)){
    showAlert("warning", "Lengkapi Data", "Nama lengkap wajib diisi dan hanya boleh berisi huruf.");
    return false;
  }
  if (!bagian){
    showAlert("warning", "Lengkapi Data", "Silakan pilih Bagian.");
    return false;
  }
  if (!shift){
    showAlert("warning", "Lengkapi Data", "Silakan pilih Shift.");
    return false;
  }
  return true;
}

$("masuk-to-step2").addEventListener("click", () => {
  if (!validasiStep1()) return;
  $("masuk-step-1").classList.add("step--hidden");
  $("masuk-step-2").classList.remove("step--hidden");
  $("masuk-progress").textContent = "Langkah 2 dari 3 — Verifikasi Lokasi";
});

/* ======================================================================
   8. ABSEN MASUK — STEP 2: GPS (HAVERSINE FORMULA)
   ====================================================================== */
function haversineDistance(lat1, lng1, lat2, lng2){
  const R = 6371000; // radius bumi dalam meter
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // dalam meter
}

$("btn-ambil-lokasi").addEventListener("click", () => {
  if (!navigator.geolocation){
    showAlert("error", "Tidak Didukung", "Perangkat/browser Anda tidak mendukung layanan lokasi.");
    return;
  }

  $("btn-ambil-lokasi").disabled = true;
  $("btn-ambil-lokasi").textContent = "Mendeteksi Lokasi...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const distance = haversineDistance(latitude, longitude, CONFIG.officeLat, CONFIG.officeLng);
      const withinRadius = distance <= CONFIG.radiusMeters;
      const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

      state.masuk.lokasi = { lat: latitude, lng: longitude, distance, mapsLink, withinRadius };

      const box = $("gps-result");
      const illus = $("gps-illustration");
      box.hidden = false;

      if (withinRadius){
        illus.className = "gps-illustration ok";
        box.className = "gps-result ok";
        box.innerHTML = `Terima kasih, Anda Sudah di Lokasi Kerja.<small>Jarak dari kantor: ${distance.toFixed(0)} meter</small>`;
        $("masuk-to-step3").disabled = false;
      } else {
        illus.className = "gps-illustration fail";
        box.className = "gps-result fail";
        box.innerHTML = `Silakan Absen di Radius Lingkungan Kerja PT Sentralindo Teguh Gemilang.<small>Jarak Anda saat ini: ${distance.toFixed(0)} meter dari kantor (maks. ${CONFIG.radiusMeters} m)</small>`;
        $("masuk-to-step3").disabled = true;
      }

      $("btn-ambil-lokasi").disabled = false;
      $("btn-ambil-lokasi").textContent = "Ambil Ulang Lokasi";
    },
    (err) => {
      $("btn-ambil-lokasi").disabled = false;
      $("btn-ambil-lokasi").textContent = "Ambil Lokasi";
      let msg = "Gagal mendapatkan lokasi. Pastikan GPS aktif dan izin lokasi diberikan.";
      if (err.code === 1) msg = "Izin lokasi ditolak. Aktifkan izin lokasi di pengaturan browser Anda.";
      showAlert("error", "Lokasi Gagal Diambil", msg);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

$("masuk-to-step3").addEventListener("click", async () => {
  if (!state.masuk.lokasi || !state.masuk.lokasi.withinRadius) return;
  $("masuk-step-2").classList.add("step--hidden");
  $("masuk-step-3").classList.remove("step--hidden");
  $("masuk-progress").textContent = "Langkah 3 dari 3 — Ambil Selfie";
  await showAlert("info", "Perlihatkan Wajah & Seragam Anda", "Posisikan wajah dan seragam kerja Anda di dalam bingkai sebelum menekan tombol Ambil Selfie.");
});

$("masuk-back-step2").addEventListener("click", () => {
  stopCamera();
  $("masuk-step-3").classList.add("step--hidden");
  $("masuk-step-2").classList.remove("step--hidden");
  $("masuk-progress").textContent = "Langkah 2 dari 3 — Verifikasi Lokasi";
});

/* ======================================================================
   9. ABSEN MASUK — STEP 3: SELFIE (MediaDevices API)
   ====================================================================== */
function stopCamera(){
  if (state.masuk.stream){
    state.masuk.stream.getTracks().forEach(track => track.stop());
    state.masuk.stream = null;
  }
}

$("btn-buka-kamera").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
      audio: false
    });
    state.masuk.stream = stream;
    const video = $("selfie-video");
    video.srcObject = stream;
    video.hidden = false;
    $("selfie-preview").hidden = true;

    $("selfie-actions-camera").hidden = true;
    $("selfie-actions-shoot").hidden = false;
    $("selfie-actions-retake").hidden = true;
  } catch (e) {
    showAlert("error", "Kamera Tidak Dapat Diakses", "Berikan izin kamera pada browser untuk melanjutkan absen.");
  }
});

$("btn-ambil-selfie").addEventListener("click", () => {
  const video = $("selfie-video");
  const canvas = $("selfie-canvas");

  const targetWidth = Math.min(CONFIG.photoMaxWidth, video.videoWidth || CONFIG.photoMaxWidth);
  const scale = targetWidth / video.videoWidth;
  canvas.width = targetWidth;
  canvas.height = video.videoHeight * scale;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", CONFIG.photoQuality);
  state.masuk.fotoBase64 = dataUrl;

  $("selfie-preview").src = dataUrl;
  $("selfie-preview").hidden = false;
  $("selfie-video").hidden = true;
  stopCamera();

  $("selfie-actions-shoot").hidden = true;
  $("selfie-actions-retake").hidden = false;
});

$("btn-ulangi-selfie").addEventListener("click", () => {
  state.masuk.fotoBase64 = null;
  $("btn-kirim-absen").disabled = true;
  $("selfie-preview").hidden = true;
  $("selfie-actions-retake").hidden = true;
  $("selfie-actions-camera").hidden = false;
});

$("btn-pakai-selfie").addEventListener("click", () => {
  $("btn-kirim-absen").disabled = false;
  showAlert("success", "Foto Diterima", "Selfie berhasil disimpan. Silakan kirim absen Anda.");
});

/* ======================================================================
   10. KIRIM ABSEN MASUK
   ====================================================================== */
$("btn-kirim-absen").addEventListener("click", async () => {
  if (!state.masuk.lokasi || !state.masuk.lokasi.withinRadius){
    showAlert("error", "Lokasi Tidak Valid", "Anda berada di luar radius perusahaan.");
    return;
  }
  if (!state.masuk.fotoBase64){
    showAlert("warning", "Selfie Diperlukan", "Silakan ambil selfie terlebih dahulu.");
    return;
  }
  if (CONFIG.SCRIPT_URL.includes("PASTE_URL")){
    showAlert("error", "Belum Terhubung", "URL Google Apps Script belum diatur. Lihat PANDUAN-PEMULA.md.");
    return;
  }

  const payload = {
    action: "absenMasuk",
    nama: $("masuk-nama").value.trim(),
    bagian: $("masuk-bagian").value,
    shift: $("masuk-shift").value,
    latitude: state.masuk.lokasi.lat,
    longitude: state.masuk.lokasi.lng,
    mapsLink: state.masuk.lokasi.mapsLink,
    fotoBase64: state.masuk.fotoBase64
  };

  toggleLoading(true, "Mengirim absen & mengunggah foto...");
  $("btn-kirim-absen").disabled = true;

  try {
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    toggleLoading(false);

    if (result.status === "success"){
      await showAlert("success", "Absen Berhasil Dikirim", `Absen masuk atas nama ${payload.nama} tercatat pada ${result.serverTime || ""}.`);
      showView("view-home");
    } else {
      showAlert("error", "Absen Gagal", result.message || "Terjadi kesalahan saat mengirim absen.");
      $("btn-kirim-absen").disabled = false;
    }
  } catch (e) {
    toggleLoading(false);
    $("btn-kirim-absen").disabled = false;
    showAlert("error", "Gagal Terhubung", "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.");
  }
});

/* ======================================================================
   11. ABSEN IJIN
   ====================================================================== */
function resetIjinForm(){
  $("ijin-nama").value = "";
  $("ijin-bagian").selectedIndex = 0;
  $("ijin-shift").selectedIndex = 0;
  $("ijin-alasan").value = "";
  $("ijin-char-count").textContent = "150";
  $("ijin-nama-error").textContent = "";
}

$("ijin-alasan").addEventListener("input", () => {
  const remaining = 150 - $("ijin-alasan").value.length;
  $("ijin-char-count").textContent = remaining;
});

$("btn-kirim-ijin").addEventListener("click", async () => {
  const nama = $("ijin-nama").value.trim();
  const bagian = $("ijin-bagian").value;
  const shift = $("ijin-shift").value;
  const alasan = $("ijin-alasan").value.trim();

  if (!nama || !onlyLetters(nama)){
    showAlert("warning", "Lengkapi Data", "Nama lengkap wajib diisi dan hanya boleh berisi huruf.");
    return;
  }
  if (!bagian){
    showAlert("warning", "Lengkapi Data", "Silakan pilih Bagian.");
    return;
  }
  if (!shift){
    showAlert("warning", "Lengkapi Data", "Silakan pilih Shift.");
    return;
  }
  if (!alasan){
    showAlert("warning", "Lengkapi Data", "Alasan ijin wajib diisi.");
    return;
  }
  if (alasan.length > 150){
    showAlert("warning", "Alasan Terlalu Panjang", "Alasan maksimal 150 karakter.");
    return;
  }
  if (CONFIG.SCRIPT_URL.includes("PASTE_URL")){
    showAlert("error", "Belum Terhubung", "URL Google Apps Script belum diatur. Lihat PANDUAN-PEMULA.md.");
    return;
  }

  const payload = {
    action: "absenIjin",
    nama, bagian, shift, alasan,
    approvalKaru: "INI AKAN DIISI OLEH KARU"
  };

  toggleLoading(true, "Mengirim absen ijin...");
  $("btn-kirim-ijin").disabled = true;

  try {
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    toggleLoading(false);
    $("btn-kirim-ijin").disabled = false;

    if (result.status === "success"){
      await showAlert("success", "Absen Ijin Terkirim", `Pengajuan ijin atas nama ${nama} telah dikirim untuk disetujui Karu.`);
      showView("view-home");
    } else {
      showAlert("error", "Gagal Mengirim", result.message || "Terjadi kesalahan saat mengirim absen ijin.");
    }
  } catch (e) {
    toggleLoading(false);
    $("btn-kirim-ijin").disabled = false;
    showAlert("error", "Gagal Terhubung", "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.");
  }
});

/* ======================================================================
   12. PWA — INSTALL PROMPT
   ====================================================================== */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  $("btn-install").hidden = false;
});

$("btn-install").addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  $("btn-install").hidden = true;
});

window.addEventListener("appinstalled", () => {
  $("btn-install").hidden = true;
});

/* ======================================================================
   13. SERVICE WORKER
   ====================================================================== */
if ("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      /* Pendaftaran service worker gagal — aplikasi tetap berjalan tanpa mode offline. */
    });
  });
}
