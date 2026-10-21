// Runs pandoc (WebAssembly) off the main thread.
// Messages in:  { id, options, stdin, files }
// Messages out: { id, ok, stdout, stderr, files, mediaFiles } | { id, ok: false, error }
import { createPandocInstance } from "../vendor/pandoc/core.js";

async function load() {
  const res = await fetch(new URL("../vendor/pandoc/pandoc.wasm.gz", import.meta.url));
  if (!res.ok) throw new Error(`Could not download the conversion engine (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 16_300_000;
  let loaded = 0;
  const counted = res.body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      loaded += chunk.byteLength;
      self.postMessage({ progress: Math.min(loaded / total, 1) });
      ctrl.enqueue(chunk);
    },
  }));
  const wasm = await new Response(counted.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return createPandocInstance(wasm);
}

const ready = load();
ready.then(() => self.postMessage({ ready: true }), (e) => self.postMessage({ fatal: e.message }));

// pandoc's WASM runtime isn't re-entrant, so run one job at a time.
let queue = Promise.resolve();
self.onmessage = (e) => {
  const { id, options, stdin, files } = e.data;
  queue = queue.then(async () => {
    try {
      const pandoc = await ready;
      const r = await pandoc.convert(options, stdin ?? null, files || {});
      self.postMessage({ id, ok: true, stdout: r.stdout, stderr: r.stderr, files: r.files, mediaFiles: r.mediaFiles });
    } catch (err) {
      self.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  });
};
