// Safari web archives (.webarchive): a binary property list holding the page's HTML
// (WebMainResource) and its images and other files (WebSubresources).

// Minimal binary plist ("bplist00") reader: ints, reals, booleans, data, strings, arrays, dicts.
export function parseBinaryPlist(buffer) {
  const b = new Uint8Array(buffer), v = new DataView(buffer);
  if (String.fromCharCode(...b.subarray(0, 8)) !== "bplist00") throw new Error("Not a binary property list");
  const t = b.length - 32;
  const offSize = b[t + 6], refSize = b[t + 7];
  const num = Number(v.getBigUint64(t + 8)), top = Number(v.getBigUint64(t + 16)), table = Number(v.getBigUint64(t + 24));
  const uint = (pos, size) => { let n = 0; for (let i = 0; i < size; i++) n = n * 256 + b[pos + i]; return n; };
  const offsets = Array.from({ length: num }, (_, i) => uint(table + i * offSize, offSize));

  const read = (ref, depth = 0) => {
    if (depth > 64) throw new Error("Property list nested too deeply");
    let p = offsets[ref];
    const marker = b[p], hi = marker >> 4, lo = marker & 15;
    const count = () => {
      if (lo !== 15) return [lo, p + 1];
      const size = 1 << (b[p + 1] & 15);
      return [uint(p + 2, size), p + 2 + size];
    };
    switch (hi) {
      case 0x0: return lo === 8 ? false : lo === 9 ? true : null;
      case 0x1: return uint(p + 1, 1 << lo);
      case 0x2: return lo === 2 ? v.getFloat32(p + 1) : v.getFloat64(p + 1);
      case 0x3: return new Date(Date.UTC(2001, 0, 1) + v.getFloat64(p + 1) * 1000);
      case 0x4: { const [n, s] = count(); return b.slice(s, s + n); }
      case 0x5: { const [n, s] = count(); return String.fromCharCode(...b.subarray(s, s + n)); }
      case 0x6: { const [n, s] = count(); let str = ""; for (let i = 0; i < n; i++) str += String.fromCharCode(v.getUint16(s + 2 * i)); return str; }
      case 0x8: return { uid: uint(p + 1, lo + 1) };
      case 0xA: { const [n, s] = count(); return Array.from({ length: n }, (_, i) => read(uint(s + i * refSize, refSize), depth + 1)); }
      case 0xD: {
        const [n, s] = count();
        const out = {};
        for (let i = 0; i < n; i++) out[read(uint(s + i * refSize, refSize), depth + 1)] = read(uint(s + (n + i) * refSize, refSize), depth + 1);
        return out;
      }
      default: return null;
    }
  };
  return read(top);
}

const toBase64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

function decodeText(bytes, encoding) {
  try { return new TextDecoder(encoding || "utf-8").decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

/** Returns the archived page as HTML with its images inlined, scripts removed. */
export function webarchiveToHtml(buffer) {
  let archive;
  try { archive = parseBinaryPlist(buffer); } catch { throw new Error("Couldn't read this web archive."); }
  const main = archive?.WebMainResource;
  if (!main?.WebResourceData) throw new Error("This web archive has no page in it.");
  const html = decodeText(main.WebResourceData, main.WebResourceTextEncodingName);
  if (!/html/i.test(main.WebResourceMIMEType || "text/html")) {
    return { html: `<pre>${html.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</pre>` };
  }
  const resources = new Map();
  for (const r of archive.WebSubresources || []) {
    if (r?.WebResourceURL && r.WebResourceData && /^image\//.test(r.WebResourceMIMEType || "")) {
      resources.set(r.WebResourceURL, `data:${r.WebResourceMIMEType};base64,${toBase64(r.WebResourceData)}`);
    }
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, noscript, iframe, link, style, meta[http-equiv]").forEach((el) => el.remove());
  for (const img of doc.querySelectorAll("img")) {
    let url;
    try { url = new URL(img.getAttribute("src") || "", main.WebResourceURL).href; } catch { url = ""; }
    if (resources.has(url)) img.setAttribute("src", resources.get(url));
    img.removeAttribute("srcset");
  }
  const title = doc.querySelector("title")?.textContent.trim();
  return { html: doc.body.innerHTML, title };
}
