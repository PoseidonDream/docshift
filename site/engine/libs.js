// Lazily loads third-party libraries so the first page view stays small.
const base = new URL("../vendor/", import.meta.url);
const once = (fn) => { let p; return () => (p ??= fn()); };

function script(path) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL(path, base);
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${path}`));
    document.head.appendChild(s);
  });
}

export const loadJSZip = once(async () => { await script("jszip/jszip.min.js"); return window.JSZip; });

export const loadXLSX = once(async () => import(new URL("xlsx/xlsx.mjs", base)));

export const loadZahl = once(async () => (await import(new URL("xlsx/xlsx.zahl.mjs", base))).default);

export const loadPdfjs = once(async () => {
  const pdfjs = await import(new URL("pdfjs/pdf.min.mjs", base));
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs/pdf.worker.min.mjs", base).href;
  return pdfjs;
});

export const loadPdfmake = once(async () => {
  await script("pdfmake/pdfmake.min.js");
  await script("pdfmake/vfs_fonts.js");
  await script("html-to-pdfmake/browser.js");
  return { pdfMake: window.pdfMake, htmlToPdfmake: window.htmlToPdfmake };
});

// ---- pandoc, in a Web Worker ----
let worker, nextId = 0;
const pending = new Map();
const progressListeners = new Set();
let engineState = { ready: false, progress: 0, error: null };

export function onEngineProgress(fn) {
  progressListeners.add(fn);
  fn(engineState);
  return () => progressListeners.delete(fn);
}

function startWorker() {
  if (worker) return;
  worker = new Worker(new URL("./pandoc-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if ("progress" in data || data.ready || data.fatal) {
      engineState = {
        ready: engineState.ready || !!data.ready,
        progress: data.ready ? 1 : data.progress ?? engineState.progress,
        error: data.fatal ?? null,
      };
      progressListeners.forEach((fn) => fn(engineState));
      if (data.fatal) for (const { reject } of pending.values()) reject(new Error(data.fatal));
      return;
    }
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    data.ok ? job.resolve(data) : job.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    engineState = { ...engineState, error: e.message || "Conversion engine crashed" };
    progressListeners.forEach((fn) => fn(engineState));
  };
}

/** Starts downloading pandoc in the background (call early). */
export function warmPandoc() { startWorker(); }

/** Runs pandoc. Throws with pandoc's error text if it produced nothing. */
export async function pandoc(options, stdin, files = {}) {
  startWorker();
  if (engineState.error) throw new Error(engineState.error);
  const id = ++nextId;
  const result = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, options, stdin, files });
  });
  const out = options["output-file"] ? result.files?.[options["output-file"]] : result.stdout;
  if (!out || (typeof out !== "string" && !out.size)) {
    const msg = (result.stderr || "").replace(/^\[WARNING\].*$/gm, "").trim();
    throw new Error(msg || "The converter produced no output.");
  }
  return { out, mediaFiles: result.mediaFiles || {}, stderr: result.stderr };
}
