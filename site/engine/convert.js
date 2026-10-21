// Conversion pipeline. Everything runs in the browser; files never leave the device.
//
// Step 1 (load): turn the input into one intermediate form:
//   { type: "pandoc", from, blob }   a format pandoc reads natively
//   { type: "html", html }           text pulled out of PDF / iWork / ODP / TXT
//   { type: "sheet", wb }            a SheetJS workbook
//   { type: "image", blob, ext }
//   { type: "media", file }          video or audio, handled by ffmpeg
// Step 2 (write): produce the requested output from that form.
import { PANDOC_READERS, UNSUPPORTED, MIME, inputExt, categoryOf } from "./formats.js";
import { loadJSZip, loadXLSX, loadZahl, loadPdfjs, loadPdfmake, pandoc } from "./libs.js";
import { extractIWork } from "./iwork.js";
import { decodeImage, encodeImage, canvasToBlob } from "./images.js";
import { convertMedia, VIDEO_OUTPUTS, AUDIO_OUTPUTS } from "./media.js";
import { webarchiveToHtml } from "./webarchive.js";

// Pandoc filter: drop images that aren't embedded in the document (e.g. an HTML file's
// separate picture files, or web links) instead of failing - the browser has no access to them.
const DROP_MISSING_IMAGES = `function Image(el)
  if el.src:match("^data:") or pandoc.mediabag.lookup(el.src) then return nil end
  return {}
end`;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ======================= Step 1: load =======================

async function load(file, ext) {
  const category = categoryOf(ext);
  if (category === "image") return { type: "image", blob: file, ext };
  if (category === "video" || category === "audio") return { type: "media", file };
  if (category === "sheet") return { type: "sheet", wb: await readWorkbook(file, ext) };
  if (ext === "webarchive") return { type: "html", ...webarchiveToHtml(await file.arrayBuffer()) };
  if (ext === "rtfd.zip") return loadRtfd(file);

  if (ext === "pages" || ext === "key") {
    let r;
    try {
      r = await extractIWork(await file.arrayBuffer(), ext, await loadJSZip());
    } catch {
      throw new Error("Couldn't read this file. It may be password-protected or damaged.");
    }
    if (r.pdf) return { type: "html", html: await pdfToHtml(r.pdf) };
    return { type: "html", html: sectionsToHtml(r), slides: r.kind === "slides" };
  }
  if (ext === "pdf") return { type: "html", html: await pdfToHtml(await file.arrayBuffer()) };
  if (ext === "odp") return { type: "html", html: await odpToHtml(file), slides: true };
  if (ext === "txt" || ext === "text") return { type: "html", html: textToHtml(await file.text()) };
  if (PANDOC_READERS[ext]) return { type: "pandoc", from: PANDOC_READERS[ext], ext, blob: file, slides: ext === "pptx" };
  throw new Error(`.${ext} files aren't supported.`);
}

// A Finder-zipped TextEdit bundle: Note.rtfd/TXT.rtf (+ attachments)
async function loadRtfd(file) {
  const zip = await (await loadJSZip()).loadAsync(await file.arrayBuffer());
  const rtf = Object.values(zip.files).find((f) => /(^|\/)TXT\.rtf$/i.test(f.name));
  if (!rtf) throw new Error("This zip doesn't contain a TextEdit .rtfd document.");
  return { type: "pandoc", from: "rtf", ext: "rtf", blob: new Blob([await rtf.async("uint8array")]) };
}

// JSON: an array of records becomes one sheet; { name: [records] } becomes several
function jsonToWorkbook(text, XLSX) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("This isn't valid JSON."); }
  const wb = XLSX.utils.book_new();
  const toRows = (v) => (Array.isArray(v) ? v : [v]).map((r) => (r && typeof r === "object" && !Array.isArray(r) ? r : { value: r }));
  const add = (name, v) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(v).map(flattenRecord)), name.slice(0, 31) || "Sheet");
  if (data && typeof data === "object" && !Array.isArray(data) && Object.values(data).every(Array.isArray)) {
    for (const [k, v] of Object.entries(data)) add(k, v);
  } else add("Data", data);
  return wb;
}
// Nested objects become "parent.child" columns
function flattenRecord(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) flattenRecord(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

async function readWorkbook(file, ext) {
  const XLSX = await loadXLSX();
  if (ext === "json") return jsonToWorkbook(await file.text(), XLSX);
  try {
    if (ext === "csv" || ext === "tsv") {
      return XLSX.read(await file.text(), { type: "string", FS: ext === "tsv" ? "\t" : undefined, cellDates: true });
    }
    return XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: true });
  } catch (e) {
    if (/password|encrypt/i.test(e.message)) throw new Error("This spreadsheet is password-protected.");
    if (/NUMBERS 09/i.test(e.message)) {
      throw new Error("This is an old Numbers '09 file, which isn't supported. Open it in Numbers, save it again, then try once more.");
    }
    throw new Error(`Couldn't read this spreadsheet (${e.message}).`);
  }
}

function sectionsToHtml({ kind, sections }) {
  if (!sections.some((s) => s.title || s.paragraphs.length)) throw new Error("No text was found in this file.");
  if (kind === "slides") {
    return sections.map((s) =>
      `<h1>${esc(s.title || "Untitled slide")}</h1>` +
      (s.paragraphs.length ? `<ul>${s.paragraphs.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "")).join("\n");
  }
  return sections.flatMap((s) => [s.title && `<h1>${esc(s.title)}</h1>`, ...s.paragraphs.map((p) => `<p>${esc(p)}</p>`)])
    .filter(Boolean).join("\n");
}

function textToHtml(text) {
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n") || "<p></p>";
}

// Rebuilds paragraphs and headings from the positioned text runs in a PDF.
async function pdfToHtml(data) {
  const pdfjs = await loadPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  } catch (e) {
    throw new Error(e?.name === "PasswordException" ? "This PDF is password-protected." : "Couldn't read this PDF.");
  }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    let cur = null;
    for (const it of items) {
      if (!("str" in it)) continue;
      const x = it.transform[4], y = it.transform[5];
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      if (!cur || Math.abs(y - cur.y) > size * 0.5) {
        if (cur) lines.push(cur);
        cur = { text: "", y, size, page: p, left: x, right: x };
      } else if (it.str && x - cur.right > size * 0.25 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) {
        cur.text += " "; // visually separate runs (e.g. table cells) with no space item between them
      }
      cur.text += it.str;
      cur.size = Math.max(cur.size, size);
      cur.right = Math.max(cur.right, x + (it.width || 0));
      if (it.hasEOL) { lines.push(cur); cur = null; }
    }
    if (cur) lines.push(cur);
  }
  const real = lines.filter((l) => l.text.trim());
  if (!real.length) throw new Error("This PDF has no selectable text (it's probably scanned images).");

  const sizes = real.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)];
  // Typical right edge of a full line, per page: a line ending well short of it ends a paragraph
  const fullRight = {};
  for (const l of real) fullRight[l.page] = Math.max(fullRight[l.page] ?? 0, l.right);

  const BULLET = /^[•‣⁃∙·▪▫●◦■□◆–—*\-]\s*/;
  const NUMBERED = /^\(?(\d{1,3}|[a-z])[.)]\s+/;
  const blocks = [];
  let prev = null;
  for (const l of real) {
    let text = l.text.replace(/\s+/g, " ").trim();
    const heading = l.size > body * 1.25 && text.length < 120;
    let list = null;
    if (!heading && BULLET.test(text) && text.replace(BULLET, "")) { list = "ul"; text = text.replace(BULLET, ""); }
    else if (!heading && NUMBERED.test(text)) { list = "ol"; text = text.replace(NUMBERED, ""); }
    const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
    const prevEndedShort = prev && prev.right < fullRight[prev.page] * 0.8;
    const last = blocks[blocks.length - 1];
    if (last && !heading && !last.heading && !list && !prevEndedShort && gap > 0 && gap < body * 1.8) {
      last.text = /[a-z]-$/.test(last.text) && /^[a-z]/.test(text) ? last.text.slice(0, -1) + text : `${last.text} ${text}`;
    } else if (heading && last?.heading && gap > 0 && gap < l.size * 1.6) {
      last.text += ` ${text}`;
    } else {
      blocks.push({ text, heading, list, level: l.size > body * 1.7 ? 1 : 2 });
    }
    prev = l;
  }
  let html = "", open = null;
  for (const b of blocks) {
    if (open && b.list !== open) { html += `</${open}>\n`; open = null; }
    if (b.list) {
      if (!open) { html += `<${b.list}>\n`; open = b.list; }
      html += `<li>${esc(b.text)}</li>\n`;
    } else {
      html += b.heading ? `<h${b.level}>${esc(b.text)}</h${b.level}>\n` : `<p>${esc(b.text)}</p>\n`;
    }
  }
  return open ? html + `</${open}>` : html;
}

async function odpToHtml(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = new DOMParser().parseFromString(await zip.file("content.xml").async("string"), "application/xml");
  const sections = [];
  for (const page of xml.getElementsByTagName("draw:page")) {
    for (const n of [...page.getElementsByTagName("presentation:notes")]) n.remove();
    let title = "";
    const paragraphs = [];
    for (const frame of page.getElementsByTagName("draw:frame")) {
      const texts = [...frame.querySelectorAll("*")].filter((n) => n.tagName === "text:p" || n.tagName === "text:h")
        .map((n) => n.textContent.trim()).filter(Boolean);
      if (!title && frame.getAttribute("presentation:class") === "title") title = texts.join(" ");
      else paragraphs.push(...texts);
    }
    if (!title && paragraphs.length) title = paragraphs.shift();
    if (title || paragraphs.length) sections.push({ title, paragraphs });
  }
  return sectionsToHtml({ kind: "slides", sections });
}

// ======================= Shared helpers =======================

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const pandocInput = (src) => ({ name: `input.${src.ext}`, files: { [`input.${src.ext}`]: src.blob } });

// HTML fragment for any non-image source, with images inlined as data: URLs
async function asHtml(src) {
  if (src.type === "html") return src.html;
  if (src.type === "sheet") return sheetToHtml(src.wb, await loadXLSX());
  const { name, files } = pandocInput(src);
  const { out, mediaFiles } = await pandoc({ from: src.from, to: "html5", "input-files": [name], "extract-media": "media", filters: ["drop-missing.lua"] }, null,
    { ...files, "drop-missing.lua": DROP_MISSING_IMAGES });
  let html = out;
  for (const [path, blob] of Object.entries(mediaFiles)) {
    html = html.split(`src="${path}"`).join(`src="${await blobToDataUrl(blob)}"`);
  }
  return html;
}

function sheetToHtml(wb, XLSX) {
  const used = wb.SheetNames.filter((n) => wb.Sheets[n]["!ref"]);
  if (!used.length) throw new Error("This spreadsheet is empty.");
  return used.map((n) => (used.length > 1 ? `<h2>${esc(n)}</h2>\n` : "") +
    XLSX.utils.sheet_to_html(wb.Sheets[n], { header: "", footer: "" })).join("\n");
}

// ======================= Step 2: write =======================

const PANDOC_WRITERS = {
  docx: "docx", odt: "odt", rtf: "rtf", html: "html5", md: "gfm", txt: "plain", epub: "epub3", tex: "latex", pptx: "pptx",
  fb2: "fb2", rst: "rst", adoc: "asciidoc", org: "org", typ: "typst", ipynb: "ipynb", dbk: "docbook5", wiki: "mediawiki",
};
const BINARY = new Set(["docx", "odt", "epub", "pptx"]);

async function toPandocTarget(src, target, title) {
  const options = { to: PANDOC_WRITERS[target], filters: ["drop-missing.lua"] };
  if (["html", "rtf", "tex", "epub", "fb2", "dbk", "typ"].includes(target)) options.standalone = true;
  if (target === "html") { options["embed-resources"] = true; options.variables = { pagetitle: title }; }
  if (["epub", "fb2", "dbk"].includes(target)) options.metadata = { title };
  if (BINARY.has(target)) options["output-file"] = `output.${target}`;

  let stdin = null, files = {};
  if (src.type === "pandoc") {
    const input = pandocInput(src);
    Object.assign(options, { from: src.from, "input-files": [input.name] });
    files = input.files;
  } else {
    options.from = "html";
    stdin = await asHtml(src);
  }
  const { out } = await pandoc(options, stdin, { ...files, "drop-missing.lua": DROP_MISSING_IMAGES });
  return typeof out === "string" ? new Blob([out], { type: `${MIME[target]};charset=utf-8` }) : out;
}

async function toPdf(src) {
  const { pdfMake, htmlToPdfmake } = await loadPdfmake();
  const make = (doc) => new Promise((resolve) => pdfMake.createPdf(doc).getBlob(resolve));

  if (src.type === "image") {
    // One page per image (multi-page TIFFs give several), each page sized to its image
    const pages = await decodeImage(src.blob, src.ext);
    const jpeg = src.ext === "jpg" || src.ext === "jpeg";
    const content = [];
    for (const [i, c] of pages.entries()) {
      const data = jpeg && i === 0 ? src.blob : await canvasToBlob(c, "image/png"); // keep JPEGs compact
      const w = c.width * 0.75, h = c.height * 0.75; // px -> pt
      content.push({ image: await blobToDataUrl(data), width: w, height: h, pageSize: { width: w, height: h }, pageBreak: i ? "before" : undefined });
    }
    return make({ pageSize: content[0].pageSize, pageMargins: 0, content });
  }

  const html = await prepareForPdf(await asHtml(src));
  const landscape = src.slides || src.type === "sheet";
  const content = htmlToPdfmake(html, { tableAutoSize: true, removeExtraBlanks: true });
  const maxW = landscape ? 760 : 515, maxH = landscape ? 400 : 660; // leave room for a heading
  const fit = (node) => {
    if (Array.isArray(node)) return node.forEach(fit);
    if (!node || typeof node !== "object") return;
    if (node.image) { delete node.width; delete node.height; node.fit = [maxW, maxH]; }
    for (const k of ["stack", "text", "ul", "ol", "columns"]) if (Array.isArray(node[k])) fit(node[k]);
    if (node.table?.body) node.table.body.forEach(fit);
  };
  fit(content);
  if (src.slides) {
    // One slide per page: break before each slide title (the top-level heading level in use)
    const level = Math.min(...content.map((n) => /^H([1-6])$/.exec(n.nodeName)?.[1] ?? 9));
    content.filter((n) => n.nodeName === `H${level}`).slice(1).forEach((n) => { n.pageBreak = "before"; });
  }
  return make({
    content,
    pageOrientation: landscape ? "landscape" : "portrait",
    defaultStyle: { fontSize: src.type === "sheet" ? 9 : src.slides ? 16 : 11, lineHeight: 1.2 },
  });
}

// Prepares HTML for pdfmake: it rejects duplicate ids (pandoc's ODT reader emits many),
// and only embeds PNG/JPEG, so other images are re-encoded or dropped.
async function prepareForPdf(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const el of doc.querySelectorAll("[id]")) el.removeAttribute("id");
  for (const el of doc.querySelectorAll("img[style]")) el.removeAttribute("style");
  for (const img of doc.querySelectorAll("img")) {
    const s = img.getAttribute("src") || "";
    if (/^data:image\/(png|jpeg)/.test(s)) continue;
    try {
      if (!s.startsWith("data:")) throw 0;
      const blob = await (await fetch(s)).blob();
      const [canvas] = await decodeImage(blob, blob.type.split("/")[1]?.replace("jpeg", "jpg"));
      img.setAttribute("src", await blobToDataUrl(await canvasToBlob(canvas, "image/png")));
    } catch {
      img.remove();
    }
  }
  return doc.body.innerHTML;
}

async function toSheetTarget(src, target, base) {
  const XLSX = await loadXLSX();
  const wb = src.type === "sheet" ? src.wb : htmlToWorkbook(await asHtml(src), XLSX);

  if (["xlsx", "xls", "ods", "numbers"].includes(target)) {
    const opts = { bookType: target === "xls" ? "biff8" : target, type: "array", compression: true };
    if (target === "numbers") opts.numbers = await loadZahl();
    return { blob: new Blob([XLSX.write(wb, opts)], { type: MIME[target] }) };
  }
  const sheets = wb.SheetNames.filter((n) => wb.Sheets[n]["!ref"]);
  if (target === "json") {
    const data = Object.fromEntries(sheets.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null })]));
    return { blob: new Blob([JSON.stringify(sheets.length === 1 ? data[sheets[0]] : data, null, 2)], { type: MIME.json }) };
  }
  if (target === "html") {
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(base)}</title><style>
body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse;margin-bottom:24px}
td,th{border:1px solid #ccc;padding:4px 8px}</style></head><body>${sheetToHtml(wb, XLSX)}</body></html>`;
    return { blob: new Blob([page], { type: MIME.html }) };
  }
  // csv / tsv: one file per sheet; several sheets are zipped together
  const FS = target === "tsv" ? "\t" : ",";
  const texts = sheets.map((n) => "﻿" + XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS }));
  if (texts.length <= 1) return { blob: new Blob([texts[0] ?? ""], { type: MIME[target] }) };
  const zip = new (await loadJSZip())();
  sheets.forEach((n, i) => zip.file(`${base} - ${n.replace(/[\\/:*?"<>|]/g, "_")}.${target}`, texts[i]));
  return { blob: await zip.generateAsync({ type: "blob", mimeType: MIME.zip }), ext: "zip" };
}

function htmlToWorkbook(html, XLSX) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const wb = XLSX.utils.book_new();
  const tables = doc.querySelectorAll("table");
  tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t, { raw: false }), `Table ${i + 1}`));
  if (!tables.length) {
    const rows = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,pre")]
      .filter((n) => !n.querySelector("p,li")).map((n) => [n.textContent.trim()]).filter(([t]) => t);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.length ? rows : [[""]]), "Text");
  }
  return wb;
}

async function toImageTarget(src, target) {
  if (src.type !== "image") throw new Error("Only images can be converted to image formats.");
  return encodeImage(await decodeImage(src.blob, src.ext), target);
}

/**
 * Converts a File to the target format.
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function convertFile(file, target, { onProgress, signal } = {}) {
  const ext = inputExt(file.name);
  if (UNSUPPORTED[ext]) throw new Error(UNSUPPORTED[ext]);
  if (!categoryOf(ext)) throw new Error(`.${ext || "?"} files aren't supported.`);
  const base = file.name.replace(/(\.(pages|key|numbers|rtfd))?\.[^.]+$/i, "") || "document";

  const src = await load(file, ext);
  let blob, outExt = target;
  if (src.type === "media" || (src.type === "image" && VIDEO_OUTPUTS.includes(target))) {
    if (!VIDEO_OUTPUTS.includes(target) && !AUDIO_OUTPUTS.includes(target)) throw new Error(`Can't convert to .${target}.`);
    blob = new Blob([await convertMedia(file, target, { onProgress, signal })]);
  } else if (["png", "jpg", "webp", "tiff", "bmp", "ico", "icns"].includes(target)) blob = await toImageTarget(src, target);
  else if (target === "pdf") blob = await toPdf(src);
  else if (["xlsx", "xls", "ods", "numbers", "csv", "tsv", "json"].includes(target) ||
           (target === "html" && src.type === "sheet")) {
    const r = await toSheetTarget(src, target, base);
    blob = r.blob; outExt = r.ext || target;
  } else if (PANDOC_WRITERS[target]) blob = await toPandocTarget(src, target, base);
  else throw new Error(`Can't convert to .${target}.`);

  if (blob.type !== MIME[outExt] && !blob.type.startsWith(MIME[outExt] ?? "-")) blob = new Blob([blob], { type: MIME[outExt] });
  return { blob, filename: `${base}.${outExt}` };
}

export { inputExt };
