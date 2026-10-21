import { OUTPUTS, UNSUPPORTED, APPLE, inputExt, categoryOf, targetsFor, defaultTarget } from "./engine/formats.js";
import { convertFile } from "./engine/convert.js";
import { warmPandoc, loadFFmpeg, loadJSZip, onEngineProgress } from "./engine/libs.js";

const $ = (s) => document.querySelector(s);
const drop = $("#drop"), picker = $("#picker"), queue = $("#queue"), tpl = $("#row-tpl");
const rows = new Set();   // files still in the list
const finished = [];      // converted files: { url, filename, blob } (kept for "download again")
let converted = 0;

const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function addFiles(files) {
  for (const file of files) {
    const ext = inputExt(file.name);
    const category = UNSUPPORTED[ext] ? null : categoryOf(ext);
    const node = tpl.content.firstElementChild.cloneNode(true);
    const row = { file, node, ext, busy: false, failed: false };
    const status = node.querySelector(".status");
    const select = node.querySelector(".target");

    node.querySelector(".badge").textContent = (ext === "rtfd.zip" ? "rtfd" : ext) || "?";
    if (category) node.querySelector(".badge").classList.add(category);
    node.querySelector(".name").textContent = file.name;
    node.querySelector(".name").title = file.name;
    node.querySelector(".meta").textContent = fmtSize(file.size) + (APPLE.has(ext.replace(".zip", "")) ? " · Mac format" : "");

    if (!category) {
      node.classList.add("unsupported");
      row.unsupported = true;
      setStatus(row, UNSUPPORTED[ext] || `.${ext || "?"} files aren't supported yet.`, "error");
    } else {
      for (const t of targetsFor(ext)) select.add(new Option(OUTPUTS[t], t));
      select.value = defaultTarget(ext);
      select.addEventListener("change", () => resetResult(row));
      node.querySelector(".go").addEventListener("click", () => (row.busy ? row.controller?.abort() : run(row)));
      // Start downloading the engine this file will need
      if (category === "document" || category === "slides") warmPandoc();
      if (category === "video" || category === "audio") loadFFmpeg().catch(() => {});
    }
    node.querySelector(".remove").addEventListener("click", () => {
      row.controller?.abort();
      rows.delete(row);
      node.remove();
      updateCounter();
    });
    status.textContent = status.textContent || "";
    rows.add(row);
    queue.appendChild(node);
  }
  updateCounter();
}

// "3 / 200 converted": converted files leave the list, so this shows what's left
function updateCounter() {
  const pending = [...rows].filter((r) => !r.unsupported);
  const failed = pending.filter((r) => r.failed).length;
  const total = converted + pending.length;
  const counter = $("#counter");
  counter.textContent = `${converted} / ${total} converted`;
  if (failed) {
    const span = document.createElement("span");
    span.className = "failed";
    span.textContent = ` · ${failed} failed`;
    counter.append(span);
  }
  $("#batch-bar").style.width = total ? `${(converted / total) * 100}%` : "0";
  $("#queue-section").hidden = rows.size === 0 && converted === 0;
  $("#all-done").hidden = !(converted > 0 && pending.length === 0);
  $("#done").hidden = finished.length === 0;
  $("#done-count").textContent = finished.length;
}

// Browsers drop downloads that start in a quick burst, so space them out
let saveQueue = Promise.resolve();
function saveFile(url, filename) {
  saveQueue = saveQueue.then(() => {
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    return new Promise((r) => setTimeout(r, 250));
  });
}

// Keeps a link to each converted file in case the browser blocked the automatic download
function addFinished(filename, blob, url) {
  finished.push({ url, filename, blob });
  const size = blob.size;
  const li = document.createElement("li");
  const a = Object.assign(document.createElement("a"), { href: url, download: filename, textContent: filename });
  const meta = Object.assign(document.createElement("span"), { className: "size", textContent: fmtSize(size) });
  li.append(a, meta);
  $("#done-list").prepend(li);
}

function setStatus(row, text, cls = "") {
  const s = row.node.querySelector(".status");
  s.textContent = text;
  s.className = `status ${cls}`;
}

function resetResult(row) {
  if (row.unsupported) return;
  setStatus(row, "");
  if (row.failed) { row.failed = false; updateCounter(); }
}

async function run(row) {
  if (row.busy || row.unsupported) return;
  const target = row.node.querySelector(".target").value;
  const go = row.node.querySelector(".go");
  resetResult(row);
  row.busy = true;
  // Video and audio can take a while, so they get progress and a Cancel button
  const media = ["video", "audio"].includes(categoryOf(row.ext)) || ["mp4", "webm"].includes(target) && row.ext === "gif";
  row.controller = media ? new AbortController() : null;
  go.disabled = !media;
  go.textContent = media ? "Cancel" : "Converting…";
  setStatus(row, "Converting…");
  const onProgress = (p) => { if (row.busy) setStatus(row, `Converting… ${Math.round(p * 100)}%`); };
  try {
    const { blob, filename } = await convertFile(row.file, target, { onProgress, signal: row.controller?.signal });
    if (!rows.has(row)) return; // removed or cleared while converting
    const url = URL.createObjectURL(blob);
    saveFile(url, filename);
    addFinished(filename, blob, url);
    converted++;
    rows.delete(row);
    row.node.remove();
    updateCounter();
  } catch (e) {
    if (!rows.has(row)) return;
    if (e.name === "AbortError") setStatus(row, "Cancelled.");
    else {
      console.error(e);
      setStatus(row, e.message || String(e), "error");
      row.failed = true;
      updateCounter();
    }
  } finally {
    row.busy = false;
    row.controller = null;
    go.disabled = false;
    go.textContent = "Convert";
  }
}

// ---- events ----
picker.addEventListener("change", () => { addFiles(picker.files); picker.value = ""; });
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
// Allow dropping anywhere on the page
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); if (!drop.contains(e.target)) addFiles(e.dataTransfer.files); });

// One .zip with every converted file (handy for big batches)
$("#zip-all").addEventListener("click", async () => {
  const button = $("#zip-all");
  button.disabled = true;
  button.textContent = "Zipping…";
  try {
    const zip = new (await loadJSZip())();
    const used = new Set();
    for (const { filename, blob } of finished) {
      // Two inputs can produce the same output name ("a.md" and "a.txt" -> "a.docx")
      let name = filename, n = 1;
      while (used.has(name)) name = filename.replace(/(\.[^.]+)?$/, ` (${++n})$1`);
      used.add(name);
      zip.file(name, blob);
    }
    const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
    saveFile(url, "DocShift converted files.zip");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    button.disabled = false;
    button.textContent = "Download all as .zip";
  }
});

let convertingAll = false;
$("#convert-all").addEventListener("click", async () => {
  if (convertingAll) return;
  convertingAll = true;
  const button = $("#convert-all");
  button.disabled = true;
  button.textContent = "Converting…";
  try {
    // Snapshot: converted rows leave the set while this runs
    for (const row of [...rows]) if (rows.has(row) && !row.unsupported && !row.busy && !row.failed) await run(row);
  } finally {
    convertingAll = false;
    button.disabled = false;
    button.textContent = "Convert all";
  }
});
$("#clear").addEventListener("click", () => {
  for (const row of rows) { row.controller?.abort(); row.node.remove(); }
  rows.clear();
  for (const f of finished) URL.revokeObjectURL(f.url);
  finished.length = 0;
  $("#done-list").replaceChildren();
  converted = 0;
  updateCounter();
});

// ---- app install & offline ----
const desktop = window.docshiftDesktop; // set by the Windows/Mac/Linux desktop app
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

if (desktop) {
  // Everything ships inside the desktop app, so no service worker or install prompt is needed
  document.documentElement.classList.add("desktop");
  desktop.onOpenFiles((files) => addFiles(files.map((f) => new File([f.data], f.name))));
  desktop.ready();
  warmPandoc();
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Offline support unavailable:", e));
}

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#install").hidden = false;
});
$("#install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#install").hidden = true;
});
// Once installed, fetch the document engine in the background so it also works offline
window.addEventListener("appinstalled", () => { $("#install").hidden = true; warmPandoc(); });
if (standalone) warmPandoc();

// iPhone/iPad Safari has no install prompt; explain Add to Home Screen instead
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if (iOS && !standalone && !desktop) $("#ios-install").hidden = false;

// Files opened with the installed app from the operating system ("Open with DocShift")
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async ({ files }) => {
    if (files?.length) addFiles(await Promise.all(files.map((h) => h.getFile())));
  });
}

// Files shared to the app on Android (the service worker stashes them)
if (new URLSearchParams(location.search).has("shared") && "caches" in window) {
  (async () => {
    const cache = await caches.open("docshift-shared");
    const files = [];
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const name = decodeURIComponent(res.headers.get("X-Filename") || "shared-file");
      files.push(new File([await res.blob()], name, { type: res.headers.get("Content-Type") || "" }));
      await cache.delete(req);
    }
    history.replaceState(null, "", location.pathname);
    addFiles(files);
  })();
}

// ---- engine download indicator ----
onEngineProgress((engines) => {
  const box = $("#engine");
  const failed = Object.values(engines).find((e) => e.error);
  const loading = Object.values(engines).find((e) => e.started && !e.ready && !e.error);
  box.classList.toggle("error", !!failed);
  if (failed) {
    box.hidden = false;
    $("#engine-text").textContent = `The ${failed.label} failed to load: ${failed.error}`;
    $("#engine-bar").style.width = "0";
    return;
  }
  box.hidden = !loading;
  if (!loading) return;
  $("#engine-text").textContent = loading.progress < 1 && !desktop
    ? `Downloading the ${loading.label} (one time, ${loading.size})… ${Math.round(loading.progress * 100)}%`
    : `Starting the ${loading.label}…`;
  $("#engine-bar").style.width = `${loading.progress * 100}%`;
});
