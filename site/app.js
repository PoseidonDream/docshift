import { INPUTS, OUTPUTS, UNSUPPORTED, inputExt, targetsFor, defaultTarget } from "./engine/formats.js";
import { convertFile } from "./engine/convert.js";
import { warmPandoc, onEngineProgress } from "./engine/libs.js";

const $ = (s) => document.querySelector(s);
const drop = $("#drop"), picker = $("#picker"), queue = $("#queue"), tpl = $("#row-tpl");
const rows = new Set();

const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function addFiles(files) {
  for (const file of files) {
    const ext = inputExt(file.name);
    const category = INPUTS[ext];
    const node = tpl.content.firstElementChild.cloneNode(true);
    const row = { file, node, ext, busy: false, url: null };
    const status = node.querySelector(".status");
    const select = node.querySelector(".target");

    node.querySelector(".badge").textContent = ext || "?";
    if (category) node.querySelector(".badge").classList.add(category);
    node.querySelector(".name").textContent = file.name;
    node.querySelector(".name").title = file.name;
    node.querySelector(".meta").textContent = fmtSize(file.size);

    if (!category) {
      node.classList.add("unsupported");
      row.unsupported = true;
      setStatus(row, UNSUPPORTED[ext] || `.${ext || "?"} files aren't supported yet.`, "error");
    } else {
      for (const t of targetsFor(ext)) select.add(new Option(OUTPUTS[t], t));
      select.value = defaultTarget(ext);
      select.addEventListener("change", () => resetResult(row));
      node.querySelector(".go").addEventListener("click", () => run(row));
      if (category === "document" || category === "slides") warmPandoc();
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
  go.disabled = true;
  go.textContent = "Converting…";
  setStatus(row, "Converting…");
  const t0 = performance.now();
  try {
    const { blob, filename } = await convertFile(row.file, target);
    row.url = URL.createObjectURL(blob);
    dl.href = row.url;
    dl.download = filename;
    dl.hidden = false;
    go.hidden = true;
    setStatus(row, `Ready: ${filename} (${fmtSize(blob.size)}, ${((performance.now() - t0) / 1000).toFixed(1)} s)`, "ok");
    dl.click();
  } catch (e) {
    console.error(e);
    setStatus(row, e.message || String(e), "error");
  } finally {
    row.busy = false;
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
let shown = false;
onEngineProgress(({ ready, progress, error }) => {
  const box = $("#engine");
  if (error) {
    box.hidden = false;
    box.classList.add("error");
    $("#engine-text").textContent = `The document engine failed to load: ${error}`;
    return;
  }
  if (ready) { box.hidden = true; return; }
  if (progress > 0 || shown) {
    shown = true;
    box.hidden = false;
    $("#engine-text").textContent = progress < 1 && !desktop
      ? `Downloading the document engine (one time, ~16 MB)… ${Math.round(progress * 100)}%`
      : "Starting the document engine…";
    $("#engine-bar").style.width = `${progress * 100}%`;
  }
});
