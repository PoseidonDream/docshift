// Image decoding and encoding.
// Browsers handle PNG/JPEG/WebP/GIF/BMP/SVG/AVIF/ICO themselves; HEIC (iPhone/Mac photos)
// uses libheif, TIFF uses UTIF, and ICNS (Mac icons) is unpacked here. Encoders for BMP,
// TIFF, ICO (Windows icons) and ICNS are written by hand: they are simple containers.
import { loadLibheif, loadUTIF } from "./libs.js";

export const IMAGE_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", icns: "image/icns",
};

function newCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function canvasFromRGBA(rgba, w, h) {
  const c = newCanvas(w, h);
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
  return c;
}

// ---------------- decoding ----------------

async function decodeHeic(data) {
  const libheif = await loadLibheif();
  const images = new libheif.HeifDecoder().decode(new Uint8Array(data));
  if (!images.length) throw new Error("Couldn't read this HEIC photo.");
  const image = images[0]; // the primary image
  const w = image.get_width(), h = image.get_height();
  const imageData = new ImageData(w, h);
  await new Promise((resolve, reject) => image.display(imageData, (r) => r ? resolve() : reject(new Error("Couldn't decode this HEIC photo."))));
  const c = newCanvas(w, h);
  c.getContext("2d").putImageData(imageData, 0, 0);
  images.forEach((img) => img.free?.());
  return [c];
}

async function decodeTiff(data) {
  const UTIF = await loadUTIF();
  const ifds = UTIF.decode(data);
  const pages = [];
  for (const ifd of ifds) {
    if (!ifd.t256 || !ifd.t257) continue; // not an image page (e.g. EXIF directory)
    UTIF.decodeImage(data, ifd);
    pages.push(canvasFromRGBA(UTIF.toRGBA8(ifd), ifd.width, ifd.height));
  }
  if (!pages.length) throw new Error("Couldn't read this TIFF image.");
  // Skip thumbnails: keep pages at least half the size of the largest
  const max = Math.max(...pages.map((p) => p.width * p.height));
  return pages.filter((p) => p.width * p.height >= max / 4);
}

// ICNS: "icns" + length, then chunks of type(4) + length(4) + data. Modern icons store PNGs.
async function decodeIcns(data) {
  const b = new Uint8Array(data), v = new DataView(data);
  if (String.fromCharCode(...b.subarray(0, 4)) !== "icns") throw new Error("This isn't a valid .icns file.");
  let best = null;
  for (let o = 8; o + 8 <= b.length;) {
    const len = v.getUint32(o + 4);
    if (len < 8) break;
    const body = b.subarray(o + 8, o + len);
    if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) {
      const w = new DataView(body.buffer, body.byteOffset).getUint32(16); // PNG IHDR width
      if (!best || w > best.w) best = { w, body };
    }
    o += len;
  }
  if (!best) throw new Error("This icon only contains old-style images, which aren't supported.");
  return [await drawToCanvas(await createImageBitmap(new Blob([best.body], { type: "image/png" })))];
}

function drawToCanvas(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = newCanvas(w, h);
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c;
}

async function decodeWithBrowser(blob) {
  // SVG (and anything createImageBitmap rejects) goes through an <img>
  try {
    if (blob.type !== "image/svg+xml") return drawToCanvas(await createImageBitmap(blob));
  } catch { /* fall through */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) { img.width = 1024; img.height = 1024; }
    return drawToCanvas(img);
  } catch {
    throw new Error("This image format can't be decoded by your browser.");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Decodes an image file into one canvas per page (TIFFs can have several). */
export async function decodeImage(blob, ext) {
  if (ext === "heic" || ext === "heif") return decodeHeic(await blob.arrayBuffer());
  if (ext === "tif" || ext === "tiff") return decodeTiff(await blob.arrayBuffer());
  if (ext === "icns") return decodeIcns(await blob.arrayBuffer());
  return [await decodeWithBrowser(new Blob([blob], { type: IMAGE_MIME[ext] || blob.type }))];
}

// ---------------- encoding ----------------

function flatten(canvas, background) {
  const c = newCanvas(canvas.width, canvas.height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

export async function canvasToBlob(canvas, mime, quality = 0.92) {
  const blob = await new Promise((r) => canvas.toBlob(r, mime, quality));
  if (!blob || blob.type !== mime) throw new Error(`Your browser can't create ${mime.split("/")[1].toUpperCase()} images.`);
  return blob;
}

// Square, transparent canvas of the given size with the image centered (for icons)
function iconCanvas(src, size) {
  const c = newCanvas(size, size);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const scale = Math.min(size / src.width, size / src.height);
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  ctx.drawImage(src, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  return c;
}

// Downscale in steps of at most 2x so small icon sizes stay sharp
function stepDown(src, size) {
  let cur = src;
  while (Math.max(cur.width, cur.height) / 2 > size) {
    const c = newCanvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  return iconCanvas(cur, size);
}

async function encodeIco(src) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map(async (s) => new Uint8Array(await (await canvasToBlob(stepDown(src, s), "image/png")).arrayBuffer())));
  const header = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
  header.setUint16(2, 1, true); // type: icon
  header.setUint16(4, sizes.length, true);
  let offset = header.byteLength;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.setUint8(e, s === 256 ? 0 : s);
    header.setUint8(e + 1, s === 256 ? 0 : s);
    header.setUint16(e + 4, 1, true);  // planes
    header.setUint16(e + 6, 32, true); // bits per pixel
    header.setUint32(e + 8, pngs[i].length, true);
    header.setUint32(e + 12, offset, true);
    offset += pngs[i].length;
  });
  return new Blob([header, ...pngs], { type: "image/x-icon" });
}

async function encodeIcns(src) {
  const types = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512],
    ["ic10", 1024], ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512]];
  const cache = {};
  const chunks = [];
  for (const [type, size] of types) {
    cache[size] ??= new Uint8Array(await (await canvasToBlob(stepDown(src, size), "image/png")).arrayBuffer());
    const head = new DataView(new ArrayBuffer(8));
    [...type].forEach((ch, i) => head.setUint8(i, ch.charCodeAt(0)));
    head.setUint32(4, 8 + cache[size].length);
    chunks.push(new Uint8Array(head.buffer), cache[size]);
  }
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const head = new DataView(new ArrayBuffer(8));
  [..."icns"].forEach((ch, i) => head.setUint8(i, ch.charCodeAt(0)));
  head.setUint32(4, total);
  return new Blob([head, ...chunks], { type: "image/icns" });
}

function encodeBmp(canvas) {
  const { width: w, height: h } = canvas;
  const px = flatten(canvas, "#ffffff").getContext("2d").getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = new ArrayBuffer(54 + row * h);
  const v = new DataView(buf), out = new Uint8Array(buf);
  v.setUint16(0, 0x4d42, true); v.setUint32(2, buf.byteLength, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true); v.setInt32(42, 2835, true); // 72 dpi
  for (let y = 0; y < h; y++) {
    const dst = 54 + (h - 1 - y) * row; // bottom-up
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = dst + x * 3;
      out[d] = px[s + 2]; out[d + 1] = px[s + 1]; out[d + 2] = px[s];
    }
  }
  return new Blob([buf], { type: "image/bmp" });
}

async function encodeTiff(canvas) {
  const UTIF = await loadUTIF();
  const px = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  return new Blob([UTIF.encodeImage(px, canvas.width, canvas.height)], { type: "image/tiff" });
}

/** Encodes the first page of a decoded image as png/jpg/webp/bmp/tiff/ico/icns. */
export async function encodeImage(pages, target) {
  const page = pages[0];
  switch (target) {
    case "png": return canvasToBlob(page, "image/png");
    case "webp": return canvasToBlob(page, "image/webp");
    case "jpg": return canvasToBlob(flatten(page, "#ffffff"), "image/jpeg");
    case "bmp": return encodeBmp(page);
    case "tiff": return encodeTiff(page);
    case "ico": return encodeIco(page);
    case "icns": return encodeIcns(page);
    default: throw new Error(`Can't create .${target} images.`);
  }
}
