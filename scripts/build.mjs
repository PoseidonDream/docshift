// Builds the static site into dist/: copies site/ and the browser builds of all
// third-party libraries into dist/vendor/. No bundler needed.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = (p) => path.join(root, "node_modules", p);
const dist = path.join(root, "dist");
const vendor = path.join(dist, "vendor");

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, "site"), dist, { recursive: true });
fs.mkdirSync(path.join(vendor, "pandoc"), { recursive: true });

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(vendor, to)), { recursive: true });
  fs.copyFileSync(nm(from), path.join(vendor, to));
};

// pandoc (WebAssembly). The wasm binary is gzipped here and inflated in the browser,
// so the download is ~16 MB whatever compression the host applies.
fs.writeFileSync(
  path.join(vendor, "pandoc/pandoc.wasm.gz"),
  zlib.gzipSync(fs.readFileSync(nm("pandoc-wasm/src/pandoc.wasm")), { level: 9 }),
  { flag: "w" },
);
// Module workers can't use import maps, so point core.js at the shim directly.
fs.writeFileSync(
  path.join(vendor, "pandoc/core.js"),
  fs.readFileSync(nm("pandoc-wasm/src/core.js"), "utf8").replace('"@bjorn3/browser_wasi_shim"', '"../wasi-shim/index.js"'),
);
fs.cpSync(nm("@bjorn3/browser_wasi_shim/dist"), path.join(vendor, "wasi-shim"), { recursive: true });

copy("xlsx/xlsx.mjs", "xlsx/xlsx.mjs");
copy("xlsx/dist/xlsx.zahl.mjs", "xlsx/xlsx.zahl.mjs");
copy("pdfjs-dist/build/pdf.min.mjs", "pdfjs/pdf.min.mjs");
copy("pdfjs-dist/build/pdf.worker.min.mjs", "pdfjs/pdf.worker.min.mjs");
copy("jszip/dist/jszip.min.js", "jszip/jszip.min.js");
copy("pdfmake/build/pdfmake.min.js", "pdfmake/pdfmake.min.js");
copy("pdfmake/build/vfs_fonts.js", "pdfmake/vfs_fonts.js");
copy("html-to-pdfmake/browser.js", "html-to-pdfmake/browser.js");

// Third-party license notices
const licenses = [
  ["pandoc / pandoc-wasm (GPL-2.0-or-later, source: https://github.com/jgm/pandoc)", "pandoc-wasm/LICENSE"],
  ["@bjorn3/browser_wasi_shim", "@bjorn3/browser_wasi_shim/LICENSE-MIT"],
  ["SheetJS (xlsx)", "xlsx/LICENSE"],
  ["PDF.js (pdfjs-dist)", "pdfjs-dist/LICENSE"],
  ["JSZip", "jszip/LICENSE.markdown"],
  ["pdfmake", "pdfmake/LICENSE"],
  ["html-to-pdfmake", "html-to-pdfmake/LICENSE"],
];
fs.writeFileSync(path.join(vendor, "LICENSES.txt"), licenses
  .map(([name, file]) => `${"=".repeat(72)}\n${name}\n${"=".repeat(72)}\n\n${fs.readFileSync(nm(file), "utf8").trim()}\n`)
  .join("\n"));

fs.rmSync(path.join(vendor, "wasi-shim/tsconfig.tsbuildinfo"), { force: true });

// Service worker: list the files to precache, and version each cache by a hash of its
// contents. Library caches (incl. the 16 MB engine) survive app-only updates.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const rel = (f) => path.relative(dist, f).split(path.sep).join("/");
const hashOf = (files) => {
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(rel(f)).update(fs.readFileSync(f));
  return h.digest("hex").slice(0, 12);
};
const all = walk(dist).sort();
const vendorFiles = all.filter((f) => rel(f).startsWith("vendor/"));
const shellFiles = all.filter((f) => !rel(f).startsWith("vendor/") && !["sw.js", ".nojekyll"].includes(rel(f)));
const swPath = path.join(dist, "sw.js");
fs.writeFileSync(swPath, fs.readFileSync(swPath, "utf8")
  .replace("__SHELL_VERSION__", hashOf(shellFiles))
  .replace("__VENDOR_VERSION__", hashOf(vendorFiles))
  .replace("__SHELL_FILES__", JSON.stringify(["./", ...shellFiles.map(rel).filter((r) => r !== "index.html")]))
  .replace("__VENDOR_FILES__", JSON.stringify(vendorFiles.map(rel).filter((r) => !r.endsWith("pandoc.wasm.gz")))));

// GitHub Pages: don't run Jekyll over the output
fs.writeFileSync(path.join(dist, ".nojekyll"), "");

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`Built dist/ (${(size(dist) / 1e6).toFixed(1)} MB)`);
