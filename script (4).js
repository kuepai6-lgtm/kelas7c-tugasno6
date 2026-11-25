/* =====================================================
   Sistem Antrean Pelayanan Publik
   Nomor antrean + pemanggilan otomatis (layar dan suara)
   Data disimpan di localStorage, sehingga tab "Loket" dan
   tab "Layar" yang dibuka berdampingan saling tersinkron.
   ===================================================== */

/* ---------- 1. KONFIGURASI (sesuaikan dengan objek kelompok Anda) ---------- */
const CONFIG = {
  instansi: "Samsat Sumedang",
  subjudul: "Kantor Bersama Samsat Kabupaten Sumedang",
  jumlahLoket: 4,
  menitPerLayananDefault: 5, // dipakai sebelum ada data layanan yang cukup
  // CATATAN: daftar layanan dan syarat di bawah adalah contoh umum.
  // Cocokkan dengan hasil observasi/wawancara kelompok di Samsat Sumedang.
  layanan: [
    { kode: "A", gambar: "aset/layanan-a.png", warna: "#3498db", nama: "Bayar Pajak Tahunan",
      ket: "Pengesahan STNK setiap tahun",
      syarat: ["STNK asli", "KTP asli pemilik kendaraan"] },
    { kode: "B", gambar: "aset/layanan-b.png", warna: "#27ae60", nama: "Perpanjang STNK 5 Tahunan",
      ket: "Perpanjangan STNK dan ganti pelat nomor",
      syarat: ["STNK asli", "BPKB asli", "KTP asli pemilik", "Hasil cek fisik kendaraan"] },
    { kode: "C", gambar: "aset/layanan-c.png", warna: "#e67e22", nama: "Balik Nama Kendaraan",
      ket: "Ganti pemilik setelah jual beli",
      syarat: ["BPKB dan STNK asli", "KTP pemilik baru", "Kuitansi/faktur jual beli", "Hasil cek fisik kendaraan"] },
    { kode: "D", gambar: "aset/layanan-d.png", warna: "#e74c3c", nama: "Informasi dan Pengaduan",
      ket: "Tanya prosedur, biaya, atau sampaikan keluhan",
      syarat: ["Bawa dokumen kendaraan jika ada"] },
  ],
};

/* ---------- 2. PENYIMPANAN DATA ---------- */
const KEY = "antrean-pelayanan-v1";

function freshState() {
  return { counters: {}, tickets: [], lastCall: null };
}
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || freshState(); }
  catch { return freshState(); }
}
function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  render();
}

/* ---------- 3. UTILITAS ---------- */
const $ = (sel) => document.querySelector(sel);
const svcName = (kode) => (CONFIG.layanan.find((l) => l.kode === kode) || {}).nama || kode;
const STATUS = { waiting: "Menunggu", serving: "Dilayani", done: "Selesai", skipped: "Tidak hadir" };

function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
}
function fmtDur(ms) {
  if (ms == null || isNaN(ms)) return "-";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} mnt ${s % 60} dtk` : `${s} dtk`;
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}
/* Perkiraan tunggu (menit) untuk orang dengan "ahead" antrean di depannya */
function perkiraanMenit(state, ahead) {
  const durasi = state.tickets
    .filter((t) => t.status === "done" && t.calledAt && t.doneAt)
    .map((t) => t.doneAt - t.calledAt);
  const menit = durasi.length >= 3 ? avg(durasi) / 60000 : CONFIG.menitPerLayananDefault;
  return Math.max(ahead === 0 ? 0 : 1, Math.round((ahead * menit) / CONFIG.jumlahLoket));
}
const svcInfo = (kode) => CONFIG.layanan.find((l) => l.kode === kode) || { nama: kode, syarat: [] };
function teksTunggu(menit) {
  return menit === 0 ? "Anda akan segera dipanggil." : `Perkiraan tunggu sekitar ${menit} menit.`;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ---------- 4. LOGIKA ANTREAN ---------- */
function takeTicket(kode) {
  const s = load();
  const n = (s.counters[kode] || 0) + 1;
  s.counters[kode] = n;
  const ticket = {
    id: Date.now() + "-" + kode + n,
    code: kode,
    n,
    no: kode + String(n).padStart(3, "0"),
    status: "waiting",
    createdAt: Date.now(),
    calledAt: null,
    doneAt: null,
    loket: null,
  };
  s.tickets.push(ticket);
  save(s);
  return ticket;
}

function servingAt(s, loket) {
  return s.tickets.find((t) => t.status === "serving" && t.loket === loket);
}

function callNext(loket, filterKode) {
  const s = load();
  const current = servingAt(s, loket);
  if (current) { current.status = "done"; current.doneAt = Date.now(); }

  const next = s.tickets
    .filter((t) => t.status === "waiting" && (!filterKode || t.code === filterKode))
    .sort((a, b) => a.createdAt - b.createdAt)[0];

  if (!next) {
    save(s);
    toast("Tidak ada antrean yang menunggu.");
    return null;
  }
  next.status = "serving";
  next.loket = loket;
  next.calledAt = Date.now();
  s.lastCall = { id: next.id, no: next.no, loket, seq: Date.now() };
  save(s);
  return s.lastCall;
}

function recall(loket) {
  const s = load();
  const t = servingAt(s, loket);
  if (!t) { toast("Belum ada nomor yang sedang dilayani di loket ini."); return null; }
  s.lastCall = { id: t.id, no: t.no, loket, seq: Date.now() };
  save(s);
  return s.lastCall;
}

function finish(loket, status) {
  const s = load();
  const t = servingAt(s, loket);
  if (!t) { toast("Belum ada nomor yang sedang dilayani di loket ini."); return; }
  t.status = status;
  t.doneAt = Date.now();
  save(s);
  toast(status === "done" ? `${t.no} selesai dilayani.` : `${t.no} ditandai tidak hadir.`);
}

/* ---------- 5. SUARA PANGGILAN ---------- */
let audioOn = false;
let audioCtx;

function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [880, 660].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + i * 0.35;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      osc.start(t0);
      osc.stop(t0 + 0.35);
    });
  } catch (e) { /* abaikan jika audio tidak tersedia */ }
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "id-ID";
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("id"));
  if (voice) u.voice = voice;
  setTimeout(() => speechSynthesis.speak(u), 750); // setelah bunyi lonceng
}

function announce(call) {
  if (!call) return;
  const big = $("#bigNo");
  if (big) {
    big.classList.remove("pulse");
    void big.offsetWidth;
    big.classList.add("pulse");
  }
  if (!audioOn) return;
  chime();
  const kode = call.no.charAt(0);
  const angka = parseInt(call.no.slice(1), 10);
  speak(`Nomor antrean ${kode}, ${angka}. Silakan menuju loket ${call.loket}.`);
}

/* ---------- 6. TAMPILAN: ROUTING ---------- */
const VIEWS = ["kios", "loket", "layar", "rekap"];
let view = "kios";
let lastSeq = (load().lastCall || {}).seq || 0;

function route() {
  const h = location.hash.slice(1);
  view = VIEWS.includes(h) ? h : "kios";
  document.body.dataset.view = view;
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  render();
}

function render() {
  if (view === "kios") renderKios();
  if (view === "loket") renderLoket();
  if (view === "layar") renderLayar();
  if (view === "rekap") renderRekap();
}

/* ---------- 7. TAMPILAN: KIOS ---------- */
function renderKios() {
  const s = load();
  $("#layananList").innerHTML = CONFIG.layanan.map((l) => {
    const w = s.tickets.filter((t) => t.code === l.kode && t.status === "waiting").length;
    return `<button class="svc" data-kode="${l.kode}" style="--c:${l.warna}">
      <span class="svc-ico">
        <img src="${l.gambar}" alt="" width="104" height="104">
        <span class="svc-letter">${l.kode}</span>
      </span>
      <span class="svc-body">
        <strong>${l.nama}</strong>
        <small>${l.ket}</small>
        <small class="svc-need">Bawa: ${l.syarat.join(", ")}</small>
      </span>
      <span class="svc-wait">${w} orang menunggu</span>
    </button>`;
  }).join("");
}

function showTicket(t) {
  const s = load();
  const ahead = s.tickets.filter((x) => x.status === "waiting" && x.createdAt < t.createdAt).length;
  const info = (ahead === 0 ? "Tidak ada antrean di depan Anda. " : `${ahead} orang di depan Anda. `) +
    teksTunggu(perkiraanMenit(s, ahead));
  const l = svcInfo(t.code);

  $("#tInst").textContent = CONFIG.instansi;
  $("#tNo").textContent = t.no;
  $("#tSvc").innerHTML = `<img src="${l.gambar}" alt="" width="64" height="64"><span>${l.nama}</span>`;
  $("#tSyarat").innerHTML = `<b>Pastikan dokumen ini sudah dibawa:</b><ul>${l.syarat.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  $("#tInfo").textContent = `${fmtTime(t.createdAt)} • ${info}`;

  $("#printTicket").innerHTML = `
    <p><b>${CONFIG.instansi}</b></p>
    <p>Nomor antrean</p>
    <p class="pt-no">${t.no}</p>
    <p><b>${l.nama}</b></p>
    <p>${new Date(t.createdAt).toLocaleString("id-ID")}</p>
    <p>${info}</p>
    <p>Dokumen: ${l.syarat.join(", ")}</p>
    <p>Dengarkan panggilan dan lihat layar.</p>`;

  $("#tiketDialog").showModal();
}

/* ---------- 8. TAMPILAN: LOKET ---------- */
const getLoket = () => Number(sessionStorage.getItem("loket") || 1);
const getFilter = () => sessionStorage.getItem("filter") || "";

function renderLoket() {
  const s = load();
  const L = getLoket();
  const now = servingAt(s, L);
  $("#loketNow").textContent = now ? now.no : "-";
  $("#loketNowSvc").textContent = now ? svcName(now.code) : "Belum ada yang dilayani";

  const waiting = s.tickets.filter((t) => t.status === "waiting").sort((a, b) => a.createdAt - b.createdAt);
  $("#waitCount").textContent = waiting.length;
  $("#waitBody").innerHTML = waiting.length
    ? waiting.slice(0, 20).map((t) =>
        `<tr><td class="no">${t.no}</td><td>${svcName(t.code)}</td><td>${fmtDur(Date.now() - t.createdAt)}</td></tr>`
      ).join("")
    : `<tr><td colspan="3" class="empty">Belum ada antrean. Ambil nomor dari menu "Ambil nomor".</td></tr>`;
}

/* ---------- 9. TAMPILAN: LAYAR PANGGILAN ---------- */
function renderLayar() {
  const s = load();
  $("#boardInst").textContent = CONFIG.instansi;
  $("#boardSub").textContent = CONFIG.subjudul;

  const lc = s.lastCall;
  $("#bigNo").textContent = lc ? lc.no : "---";
  $("#bigLoket").textContent = lc ? `Loket ${lc.loket}` : "Menunggu panggilan";

  let cards = "";
  for (let i = 1; i <= CONFIG.jumlahLoket; i++) {
    const t = servingAt(s, i);
    cards += `<div class="loket-card"><span>Loket ${i}</span>` +
      (t ? `<span class="lc-no">${t.no}</span>` : `<span class="lc-idle">kosong</span>`) + `</div>`;
  }
  $("#loketCards").innerHTML = cards;

  const recent = s.tickets.filter((t) => t.calledAt).sort((a, b) => b.calledAt - a.calledAt).slice(1, 5);
  $("#recentCalls").innerHTML = recent.length
    ? recent.map((t) => `<div class="recent-row"><span>${t.no}</span><span>Loket ${t.loket}</span></div>`).join("")
    : `<div class="lc-idle">Belum ada</div>`;

  const totalWait = s.tickets.filter((t) => t.status === "waiting").length;
  $("#boardWait").innerHTML = CONFIG.layanan.map((l) => {
    const w = s.tickets.filter((t) => t.code === l.kode && t.status === "waiting").length;
    return `<span><b>${l.kode}</b> ${l.nama}: ${w} menunggu</span>`;
  }).join("") + `<span class="est">Antrean baru: ${teksTunggu(perkiraanMenit(s, totalWait)).replace("Anda akan segera dipanggil.", "langsung dipanggil.")}</span>`;

  $("#audioGate").hidden = audioOn;
}

function tickClock() {
  const el = $("#clock");
  if (el) el.textContent = new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "medium" });
}

/* ---------- 10. TAMPILAN: REKAP ---------- */
function renderRekap() {
  const s = load();
  const T = s.tickets;
  const waits = T.filter((t) => t.calledAt).map((t) => t.calledAt - t.createdAt);
  const services = T.filter((t) => t.status === "done" && t.calledAt && t.doneAt).map((t) => t.doneAt - t.calledAt);

  const stat = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  $("#stats").innerHTML =
    stat(T.length, "Total nomor diambil") +
    stat(T.filter((t) => t.status === "done").length, "Selesai dilayani") +
    stat(T.filter((t) => t.status === "waiting").length, "Masih menunggu") +
    stat(fmtDur(avg(waits)), "Rata-rata waktu tunggu") +
    stat(fmtDur(avg(services)), "Rata-rata lama layanan");

  $("#svcBody").innerHTML = CONFIG.layanan.map((l) => {
    const list = T.filter((t) => t.code === l.kode);
    const w = list.filter((t) => t.calledAt).map((t) => t.calledAt - t.createdAt);
    return `<tr><td>${l.kode} - ${l.nama}</td><td>${list.length}</td>
      <td>${list.filter((t) => t.status === "done").length}</td>
      <td>${list.filter((t) => t.status === "waiting").length}</td>
      <td>${fmtDur(avg(w))}</td></tr>`;
  }).join("");

  const recent = T.slice().reverse().slice(0, 30);
  $("#histBody").innerHTML = recent.length
    ? recent.map((t) => `<tr>
        <td class="no">${t.no}</td><td>${svcName(t.code)}</td>
        <td class="st st-${t.status}">${STATUS[t.status]}</td>
        <td>${t.loket || "-"}</td><td>${fmtTime(t.createdAt)}</td>
        <td>${t.calledAt ? fmtDur(t.calledAt - t.createdAt) : "-"}</td>
        <td>${t.doneAt && t.calledAt ? fmtDur(t.doneAt - t.calledAt) : "-"}</td></tr>`).join("")
    : `<tr><td colspan="7" class="empty">Belum ada data.</td></tr>`;
}

function exportCsv() {
  const s = load();
  const rows = [["Nomor", "Layanan", "Status", "Loket", "Waktu ambil", "Waktu panggil", "Waktu selesai", "Tunggu (detik)", "Layanan (detik)"]];
  s.tickets.forEach((t) => rows.push([
    t.no, svcName(t.code), STATUS[t.status], t.loket || "",
    new Date(t.createdAt).toLocaleString("id-ID"),
    t.calledAt ? new Date(t.calledAt).toLocaleString("id-ID") : "",
    t.doneAt ? new Date(t.doneAt).toLocaleString("id-ID") : "",
    t.calledAt ? Math.round((t.calledAt - t.createdAt) / 1000) : "",
    t.calledAt && t.doneAt ? Math.round((t.doneAt - t.calledAt) / 1000) : "",
  ]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rekap-antrean.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- 11. EVENT ---------- */
function init() {
  // isi pilihan loket dan filter layanan
  $("#selLoket").innerHTML = Array.from({ length: CONFIG.jumlahLoket }, (_, i) =>
    `<option value="${i + 1}">Loket ${i + 1}</option>`).join("");
  $("#selFilter").innerHTML = `<option value="">Semua layanan</option>` +
    CONFIG.layanan.map((l) => `<option value="${l.kode}">${l.kode} - ${l.nama}</option>`).join("");
  $("#selLoket").value = getLoket();
  $("#selFilter").value = getFilter();

  $("#selLoket").addEventListener("change", (e) => { sessionStorage.setItem("loket", e.target.value); render(); });
  $("#selFilter").addEventListener("change", (e) => sessionStorage.setItem("filter", e.target.value));

  // kios
  $("#layananList").addEventListener("click", (e) => {
    const btn = e.target.closest(".svc");
    if (btn) showTicket(takeTicket(btn.dataset.kode));
  });
  $("#tClose").addEventListener("click", () => $("#tiketDialog").close());
  $("#tPrint").addEventListener("click", () => window.print());

  // loket
  const localSound = (call) => { if ($("#localSound").checked && call) { audioOn = true; announce(call); } };
  $("#btnNext").addEventListener("click", () => localSound(callNext(getLoket(), getFilter())));
  $("#btnRecall").addEventListener("click", () => localSound(recall(getLoket())));
  $("#btnDone").addEventListener("click", () => finish(getLoket(), "done"));
  $("#btnSkip").addEventListener("click", () => finish(getLoket(), "skipped"));

  // layar
  $("#btnAudio").addEventListener("click", () => {
    audioOn = true;
    speak("Suara panggilan aktif.");
    render();
  });
  $("#btnFull").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  // rekap
  $("#btnCsv").addEventListener("click", exportCsv);
  $("#btnReset").addEventListener("click", () => {
    if (confirm("Hapus semua data antrean? Tindakan ini tidak bisa dibatalkan.")) {
      localStorage.removeItem(KEY);
      lastSeq = 0;
      render();
      toast("Data antrean dihapus.");
    }
  });

  // sinkron antar tab: dipicu saat tab lain mengubah data
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const s = load();
    if (s.lastCall && s.lastCall.seq !== lastSeq) {
      lastSeq = s.lastCall.seq;
      if (view === "layar") announce(s.lastCall);
    }
    render();
  });

  window.addEventListener("hashchange", route);
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  setInterval(() => { tickClock(); if (view === "loket") renderLoket(); }, 1000);
  tickClock();
  route();
}

init();
