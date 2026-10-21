// Best-effort text extraction from Apple iWork files (Pages, Keynote) without a server.
//
// Supports:
//  - iWork 2013+ "IWA" packages: Index/*.iwa = Snappy-compressed protobuf archives.
//    Text lives in TSWP.StorageArchive messages (type 2001, field 3).
//  - iWork '09 XML packages (index.xml / index.apxl, optionally gzipped).
//  - As a last resort, the embedded QuickLook/Preview.pdf.
//
// Returns { kind: "document" | "slides", sections: [{ title, paragraphs[] }] }
//      or { pdf: Uint8Array } when only a preview PDF is available.

const TSWP_STORAGE = 2001;
const STORAGE_KIND = { BODY: 0, HEADER: 1, FOOTNOTE: 2, TEXTBOX: 3, NOTE: 4, CELL: 5 };

// ---------- Snappy (raw block format, as used inside IWA chunks) ----------
function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do {
    b = buf[pos.i++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return result;
}

function snappyDecompress(src) {
  const pos = { i: 0 };
  const outLen = readVarint(src, pos);
  const out = new Uint8Array(outLen);
  let o = 0;
  while (pos.i < src.length) {
    const tag = src[pos.i++];
    const type = tag & 3;
    if (type === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const n = len - 59;
        len = 0;
        for (let k = 0; k < n; k++) len |= src[pos.i++] << (8 * k);
      }
      len += 1;
      out.set(src.subarray(pos.i, pos.i + len), o);
      pos.i += len; o += len;
      continue;
    }
    let len, off;
    if (type === 1) {
      len = 4 + ((tag >> 2) & 7);
      off = ((tag >> 5) << 8) | src[pos.i++];
    } else if (type === 2) {
      len = (tag >> 2) + 1;
      off = src[pos.i] | (src[pos.i + 1] << 8);
      pos.i += 2;
    } else {
      len = (tag >> 2) + 1;
      off = (src[pos.i] | (src[pos.i + 1] << 8) | (src[pos.i + 2] << 16) | (src[pos.i + 3] << 24)) >>> 0;
      pos.i += 4;
    }
    for (let k = 0; k < len; k++, o++) out[o] = out[o - off];
  }
  return out;
}

function decodeIwa(data) {
  const parts = [];
  let i = 0, total = 0;
  while (i + 4 <= data.length) {
    const len = data[i + 1] | (data[i + 2] << 8) | (data[i + 3] << 16);
    const chunk = snappyDecompress(data.subarray(i + 4, i + 4 + len));
    parts.push(chunk); total += chunk.length;
    i += 4 + len;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- Minimal protobuf reader ----------
function parseProto(buf) {
  const fields = {};
  const pos = { i: 0 };
  while (pos.i < buf.length) {
    const key = readVarint(buf, pos);
    const num = Math.floor(key / 8), wire = key & 7;
    let val;
    if (wire === 0) val = readVarint(buf, pos);
    else if (wire === 1) { val = buf.subarray(pos.i, pos.i + 8); pos.i += 8; }
    else if (wire === 2) { const l = readVarint(buf, pos); val = buf.subarray(pos.i, pos.i + l); pos.i += l; }
    else if (wire === 5) { val = buf.subarray(pos.i, pos.i + 4); pos.i += 4; }
    else throw new Error("Unsupported protobuf wire type " + wire);
    (fields[num] ||= []).push(val);
  }
  return fields;
}

// Yields { id, type, payload } for every message in a decoded .iwa stream.
function* iwaMessages(buf) {
  const pos = { i: 0 };
  while (pos.i < buf.length) {
    const infoLen = readVarint(buf, pos);
    const info = parseProto(buf.subarray(pos.i, pos.i + infoLen));
    pos.i += infoLen;
    const id = info[1]?.[0];
    for (const mi of info[2] || []) {
      const m = parseProto(mi);
      const type = m[1]?.[0], len = m[3]?.[0] ?? 0;
      yield { id, type, payload: buf.subarray(pos.i, pos.i + len) };
      pos.i += len;
    }
  }
}

const utf8 = new TextDecoder("utf-8");

function cleanText(s) {
  return s
    .replace(/[\uFFFC\uFFFD]/g, "")       // attachment / object placeholders
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n")
    .replace(/\u0004|\u0005/g, "");        // section / page break markers
}

function storageText(payload) {
  const f = parseProto(payload);
  const kind = f[1]?.[0] ?? STORAGE_KIND.BODY;
  const text = (f[3] || []).map((b) => utf8.decode(b)).join("");
  return { kind, text: cleanText(text) };
}

function toParagraphs(text) {
  return text.split(/\n/).map((s) => s.trim()).filter(Boolean);
}

// ---------- IWA packages ----------
async function extractIwa(files, isKeynote) {
  const names = Object.keys(files).filter((n) => /(^|\/)Index\/.*\.iwa$/.test(n));
  const storagesFrom = async (name) => {
    const buf = decodeIwa(await files[name].async("uint8array"));
    const out = [];
    for (const m of iwaMessages(buf)) {
      if (m.type === TSWP_STORAGE) out.push(storageText(m.payload));
    }
    return out;
  };

  if (isKeynote) {
    const slideFiles = names.filter((n) => /\/Slide[^/]*\.iwa$/.test(n) && !/TemplateSlide/.test(n)).sort();
    const sections = [];
    for (const name of slideFiles) {
      const paras = (await storagesFrom(name))
        .filter((s) => s.kind !== STORAGE_KIND.NOTE)
        .flatMap((s) => toParagraphs(s.text));
      if (paras.length) sections.push({ title: paras[0], paragraphs: paras.slice(1) });
    }
    return { kind: "slides", sections };
  }

  const docName = names.find((n) => /\/Document\.iwa$/.test(n));
  const storages = docName ? await storagesFrom(docName) : [];
  const body = storages.filter((s) => s.kind === STORAGE_KIND.BODY);
  const boxes = storages.filter((s) => s.kind === STORAGE_KIND.TEXTBOX);
  const paragraphs = [...body, ...boxes].flatMap((s) => toParagraphs(s.text));
  return { kind: "document", sections: [{ title: "", paragraphs }] };
}

// ---------- iWork '09 XML packages ----------
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function xmlText(fragment) {
  return fragment
    .replace(/<sf:(br|lnbr|crbr)\s*\/>/g, "\n")
    .replace(/<sf:tab\s*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);
}
function xmlParagraphs(xml) {
  const paras = [];
  for (const m of xml.matchAll(/<sf:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/sf:p>)/g)) {
    const t = xmlText(m[1] || "").trim();
    if (t) paras.push(t);
  }
  return paras;
}

async function readMaybeGz(file) {
  const data = await file.async("uint8array");
  if (data[0] === 0x1f && data[1] === 0x8b) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }
  return utf8.decode(data);
}

async function extractXml(file, isKeynote) {
  const xml = await readMaybeGz(file);
  if (isKeynote) {
    const sections = [];
    for (const m of xml.matchAll(/<key:slide[\s>][\s\S]*?<\/key:slide>/g)) {
      // Skip presenter notes
      const paras = xmlParagraphs(m[0].replace(/<key:notes\b[\s\S]*?<\/key:notes>/g, ""));
      if (paras.length) sections.push({ title: paras[0], paragraphs: paras.slice(1) });
    }
    return { kind: "slides", sections };
  }
  const bodyMatch = xml.match(/<sf:text-body\b[\s\S]*<\/sf:text-body>/);
  return { kind: "document", sections: [{ title: "", paragraphs: xmlParagraphs(bodyMatch ? bodyMatch[0] : xml) }] };
}

/**
 * @param {ArrayBuffer|Uint8Array} data  the .pages / .key file (a zip)
 * @param {"pages"|"key"} ext
 * @param {typeof import("jszip")} JSZip
 */
export async function extractIWork(data, ext, JSZip) {
  const isKeynote = ext === "key";
  let zip = await JSZip.loadAsync(data);
  // Some packages nest everything inside Index.zip
  const nested = Object.keys(zip.files).find((n) => /(^|\/)Index\.zip$/.test(n));
  if (nested) {
    const inner = await JSZip.loadAsync(await zip.files[nested].async("uint8array"));
    for (const [n, f] of Object.entries(inner.files)) zip.files["Index/" + n.replace(/^Index\//, "")] ??= f;
  }
  const files = zip.files;
  const names = Object.keys(files);

  let result = null;
  if (names.some((n) => /(^|\/)Index\/.*\.iwa$/.test(n))) {
    result = await extractIwa(files, isKeynote);
  } else {
    const xmlName = names.find((n) => /(^|\/)(index\.xml|index\.apxl|presentation\.apxl)(\.gz)?$/.test(n));
    if (xmlName) result = await extractXml(files[xmlName], isKeynote);
  }
  const hasText = result?.sections.some((s) => s.title || s.paragraphs.length);
  if (hasText) return result;

  const preview = names.find((n) => /QuickLook\/Preview\.pdf$/.test(n));
  if (preview) return { pdf: await files[preview].async("uint8array") };
  return result ?? { kind: isKeynote ? "slides" : "document", sections: [] };
}
