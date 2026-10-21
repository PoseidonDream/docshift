import { OUTPUTS, UNSUPPORTED, APPLE, inputExt, categoryOf, targetsFor, defaultTarget } from "./engine/formats.js";
import { convertFile } from "./engine/convert.js";
import { warmPandoc, loadFFmpeg, onEngineProgress } from "./engine/libs.js";

const $ = (s) => document.querySelector(s);
const drop = $("#drop"), picker = $("#picker"), queue = $("#queue"), tpl = $("#row-tpl");
const rows = new Set();

const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function addFiles(files) {
  for (const file of files) {
    const ext = inputExt(file.name);
    const category = UNSUPPORTED[ext] ? null : categoryOf(ext);
    const node = tpl.content.firstElementChild.cloneNode(true);
    const row = { file, node, ext, busy: false, url: null };
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
      resetResult(row);
      rows.delete(row);
      node.remove();
      $("#queue-section").hidden = rows.size === 0;
    });
    status.textContent = status.textContent || "";
    rows.add(row);
    queue.appendChild(node);
  }
  $("#queue-section").hidden = rows.size === 0;
}

function setStatus(row, text, cls = "") {
  const s = row.node.querySelector(".status");
  s.textContent = text;
  s.className = `status ${cls}`;
}

function resetResult(row) {
  if (row.url) URL.revokeObjectURL(row.url);
  row.url = null;
  row.node.querySelector(".dl").hidden = true;
  row.node.querySelector(".go").hidden = false;
  if (!row.unsupported) setStatus(row, "");
}

async function run(row) {
  if (row.busy || row.unsupported) return;
  const target = row.node.querySelector(".target").value;
  const go = row.node.querySelector(".go"), dl = row.node.querySelector(".dl");
  resetResult(row);
  row.busy = true;
  // Video and audio can take a while, so they get progress and a Cancel button
  const media = ["video", "audio"].includes(categoryOf(row.ext)) || ["mp4", "webm"].includes(target) && row.ext === "gif";
  row.controller = media ? new AbortController() : null;
  go.disabled = !media;
  go.textContent = media ? "Cancel" : "Converting…";
  setStatus(row, "Converting…");
  const onProgress = (p) => { if (row.busy) setStatus(row, `Converting… ${Math.round(p * 100)}%`); };
  const t0 = performance.now();
  try {
    const { blob, filename } = await convertFile(row.file, target, { onProgress, signal: row.controller?.signal });
    row.url = URL.createObjectURL(blob);
    dl.href = row.url;
    dl.download = filename;
    dl.hidden = false;
    go.hidden = true;
    setStatus(row, `Ready: ${filename} (${fmtSize(blob.size)}, ${((performance.now() - t0) / 1000).toFixed(1)} s)`, "ok");
    dl.click();
  } catch (e) {
    if (e.name === "AbortError") setStatus(row, "Cancelled.");
    else { console.error(e); setStatus(row, e.message || String(e), "error"); }
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

$("#convert-all").addEventListener("click", async () => {
  for (const row of rows) if (!row.url) await run(row);
});
$("#clear").addEventListener("click", () => {
  for (const row of rows) { resetResult(row); row.node.remove(); }
  rows.clear();
  $("#queue-section").hidden = true;
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
