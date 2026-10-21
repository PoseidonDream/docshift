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

export const loadUTIF = once(async () => {
  await script("pako/pako.min.js"); // UTIF uses it for compressed TIFFs
  await script("utif/UTIF.js");
  return window.UTIF;
});

export const loadLibheif = once(async () => {
  const factory = (await import(new URL("libheif/libheif-bundle.mjs", base))).default;
  const lib = factory();
  if (lib.ready) await lib.ready;
  return lib;
});

// ---- download progress of the big engines (shown in the UI) ----
const engines = {
  document: { label: "document engine", size: "~16 MB", started: false, ready: false, progress: 0, error: null },
  media: { label: "video & audio engine", size: "~10 MB", started: false, ready: false, progress: 0, error: null },
};
const progressListeners = new Set();

function setEngine(name, patch) {
  Object.assign(engines[name], patch);
  progressListeners.forEach((fn) => fn(engines));
}

/** fn(engines) is called whenever an engine's download state changes. */
export function onEngineProgress(fn) {
  progressListeners.add(fn);
  fn(engines);
  return () => progressListeners.delete(fn);
}

// Downloads a gzipped file, reporting progress, and returns the inflated bytes.
async function fetchGzip(url, expectedSize, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url.pathname.split("/").pop()} (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || expectedSize;
  let loaded = 0;
  const counted = res.body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      loaded += chunk.byteLength;
      onProgress(Math.min(loaded / total, 1));
      ctrl.enqueue(chunk);
    },
  }));
  return new Response(counted.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

// ---- ffmpeg (video & audio), in its own Web Worker ----
let ffmpegPromise = null, ffmpegInstance = null, ffmpegWasmUrl = null;

export function loadFFmpeg() {
  ffmpegPromise ??= (async () => {
    setEngine("media", { started: true, error: null });
    const { FFmpeg } = await import(new URL("ffmpeg/index.js", base));
    if (!ffmpegWasmUrl) {
      const wasm = await fetchGzip(new URL("ffmpeg-core/ffmpeg-core.wasm.gz", base), 10_300_000, (p) => setEngine("media", { progress: p }));
      ffmpegWasmUrl = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    }
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL: new URL("ffmpeg-core/ffmpeg-core.js", base).href, wasmURL: ffmpegWasmUrl });
    ffmpegInstance = ffmpeg;
    setEngine("media", { ready: true, progress: 1 });
    return ffmpeg;
  })().catch((e) => {
    ffmpegPromise = null;
    setEngine("media", { error: e.message });
    throw e;
  });
  return ffmpegPromise;
}

/** Stops a running ffmpeg job; the next loadFFmpeg() starts a fresh instance. */
export function resetFFmpeg() {
  ffmpegInstance?.terminate();
  ffmpegInstance = null;
  ffmpegPromise = null;
}

// ---- pandoc, in a Web Worker ----
let worker, nextId = 0;
const pending = new Map();

function startWorker() {
  if (worker) return;
  worker = new Worker(new URL("./pandoc-worker.js", import.meta.url), { type: "module" });
  setEngine("document", { started: true });
  worker.onmessage = ({ data }) => {
    if ("progress" in data || data.ready || data.fatal) {
      setEngine("document", {
        ready: engines.document.ready || !!data.ready,
        progress: data.ready ? 1 : data.progress ?? engines.document.progress,
        error: data.fatal ?? null,
      });
      if (data.fatal) for (const { reject } of pending.values()) reject(new Error(data.fatal));
      return;
    }
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    data.ok ? job.resolve(data) : job.reject(new Error(data.error));
  };
  worker.onerror = (e) => setEngine("document", { error: e.message || "Conversion engine crashed" });
}

/** Starts downloading pandoc in the background (call early). */
export function warmPandoc() { startWorker(); }

/** Runs pandoc. Throws with pandoc's error text if it produced nothing. */
export async function pandoc(options, stdin, files = {}) {
  startWorker();
  if (engines.document.error) throw new Error(engines.document.error);
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
