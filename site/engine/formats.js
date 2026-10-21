// Catalog of every format DocShift understands.

// Input extension -> category. "document" and "slides" go through pandoc, "sheet" through
// SheetJS, "image" through the canvas (plus libheif/UTIF), "video"/"audio" through ffmpeg.
export const INPUTS = {
  // Documents
  docx: "document", odt: "document", rtf: "document", pdf: "document", pages: "document",
  epub: "document", html: "document", htm: "document", xhtml: "document", webarchive: "document", rtfd: "document",
  md: "document", markdown: "document", txt: "document", text: "document",
  tex: "document", latex: "document", rst: "document", org: "document", ipynb: "document",
  typ: "document", fb2: "document", adoc: "document", asciidoc: "document", textile: "document",
  opml: "document", dbk: "document", wiki: "document", djot: "document",
  // Presentations
  pptx: "slides", key: "slides", odp: "slides",
  // Spreadsheets
  xlsx: "sheet", xlsm: "sheet", xlsb: "sheet", xls: "sheet", ods: "sheet", fods: "sheet",
  numbers: "sheet", csv: "sheet", tsv: "sheet", dbf: "sheet", json: "sheet",
  // Images
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", bmp: "image",
  svg: "image", avif: "image", ico: "image", heic: "image", heif: "image", tif: "image", tiff: "image", icns: "image",
  // Video
  mov: "video", mp4: "video", m4v: "video", mkv: "video", webm: "video", avi: "video", wmv: "video",
  flv: "video", "3gp": "video", mpg: "video", mpeg: "video", mts: "video", m2ts: "video", ogv: "video",
  // Audio
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", flac: "audio", ogg: "audio", oga: "audio",
  opus: "audio", aiff: "audio", aif: "audio", caf: "audio", wma: "audio", amr: "audio", m4r: "audio",
};

// Formats used mainly on Apple devices (labelled in the UI)
export const APPLE = new Set(["pages", "numbers", "key", "heic", "heif", "mov", "m4v", "m4a", "m4r", "aiff", "aif", "caf", "icns", "webarchive", "rtfd"]);

// Formats pandoc can read directly (extension -> pandoc reader name)
export const PANDOC_READERS = {
  docx: "docx", odt: "odt", rtf: "rtf", epub: "epub", html: "html", htm: "html", xhtml: "html",
  md: "markdown", markdown: "markdown", tex: "latex", latex: "latex", rst: "rst", org: "org",
  ipynb: "ipynb", typ: "typst", fb2: "fb2", adoc: "asciidoc", asciidoc: "asciidoc",
  textile: "textile", opml: "opml", dbk: "docbook", wiki: "mediawiki", djot: "djot", pptx: "pptx",
};

// Output formats: extension -> label shown in the UI
export const OUTPUTS = {
  docx: "Word (.docx)",
  odt: "OpenDocument Text (.odt)",
  rtf: "Rich Text (.rtf)",
  pdf: "PDF (.pdf)",
  html: "Web page (.html)",
  md: "Markdown (.md)",
  txt: "Plain text (.txt)",
  epub: "E-book (.epub)",
  fb2: "FictionBook e-book (.fb2)",
  tex: "LaTeX (.tex)",
  rst: "reStructuredText (.rst)",
  adoc: "AsciiDoc (.adoc)",
  org: "Org mode (.org)",
  typ: "Typst (.typ)",
  ipynb: "Jupyter notebook (.ipynb)",
  dbk: "DocBook XML (.dbk)",
  wiki: "MediaWiki (.wiki)",
  pptx: "PowerPoint (.pptx)",
  xlsx: "Excel (.xlsx)",
  xls: "Excel 97–2003 (.xls)",
  ods: "OpenDocument Spreadsheet (.ods)",
  numbers: "Apple Numbers (.numbers)",
  csv: "CSV (.csv)",
  tsv: "Tab-separated (.tsv)",
  json: "JSON (.json)",
  png: "PNG image (.png)",
  jpg: "JPEG image (.jpg)",
  webp: "WebP image (.webp)",
  tiff: "TIFF image (.tiff)",
  bmp: "Bitmap image (.bmp)",
  ico: "Windows icon (.ico)",
  icns: "Mac icon (.icns)",
  mp4: "MP4 video (.mp4)",
  mov: "QuickTime video (.mov)",
  mkv: "Matroska video (.mkv)",
  webm: "WebM video (.webm)",
  avi: "AVI video (.avi)",
  gif: "Animated GIF (.gif)",
  mp3: "MP3 audio (.mp3)",
  m4a: "AAC audio (.m4a)",
  wav: "WAV audio (.wav)",
  flac: "FLAC audio (.flac)",
  ogg: "Ogg Vorbis audio (.ogg)",
  aiff: "AIFF audio (.aiff)",
};

const DOC_EXTRA = ["fb2", "rst", "adoc", "org", "typ", "ipynb", "dbk", "wiki"];

// Which outputs make sense for each input category, in menu order
export const TARGETS = {
  document: ["docx", "pdf", "odt", "rtf", "html", "md", "txt", "epub", "pptx", "xlsx", "ods", "csv", "tex", ...DOC_EXTRA],
  slides: ["pptx", "pdf", "docx", "odt", "html", "md", "txt"],
  sheet: ["xlsx", "csv", "pdf", "ods", "numbers", "xls", "tsv", "html", "json", "docx", "odt", "md", "txt"],
  image: ["jpg", "png", "webp", "pdf", "tiff", "bmp", "ico", "icns"],
  video: ["mp4", "mov", "mkv", "webm", "avi", "gif", "mp3", "m4a", "wav"],
  audio: ["mp3", "m4a", "wav", "flac", "ogg", "aiff"],
};
// Animated GIFs can also become video
const EXTRA_TARGETS = { gif: ["mp4", "webm"] };

// Defaults: Apple formats -> the usual Windows/universal equivalent, and vice versa
const DEFAULTS = {
  pages: "docx", key: "pptx", numbers: "xlsx", rtfd: "docx", webarchive: "pdf",
  heic: "jpg", heif: "jpg", icns: "ico", ico: "png", tif: "jpg", tiff: "jpg", png: "jpg", jpg: "png", jpeg: "png",
  mov: "mp4", m4v: "mp4", mkv: "mp4", webm: "mp4", avi: "mp4", wmv: "mp4", flv: "mp4", "3gp": "mp4", mpg: "mp4", mpeg: "mp4", mts: "mp4", m2ts: "mp4", ogv: "mp4", mp4: "mov",
  m4a: "mp3", m4r: "mp3", aiff: "wav", aif: "wav", caf: "wav", wav: "mp3", flac: "mp3", ogg: "mp3", oga: "mp3", opus: "mp3", wma: "mp3", amr: "mp3", aac: "mp3", mp3: "m4a",
  pdf: "docx", docx: "pdf", pptx: "pdf", xlsx: "csv", csv: "xlsx", json: "xlsx",
};

// Files that can't be read in the browser
export const UNSUPPORTED = {
  doc: "Old Word (.doc) files can't be read in the browser. Open it in Word or LibreOffice and save as .docx first.",
  ppt: "Old PowerPoint (.ppt) files can't be read in the browser. Save it as .pptx first.",
  rtfd: "TextEdit .rtfd documents are folders. Right-click it in Finder, choose Compress, and drop the .rtfd.zip here.",
};

export function inputExt(filename) {
  const name = filename.toLowerCase();
  // Finder-zipped packages: "Report.pages.zip", "Note.rtfd.zip"
  const m = name.match(/\.(pages|key|numbers|rtfd)\.zip$/);
  if (m) return m[1] === "rtfd" ? "rtfd.zip" : m[1];
  return name.includes(".") ? name.split(".").pop() : "";
}

// "rtfd.zip" is how a zipped TextEdit bundle is identified
const category = (ext) => INPUTS[ext === "rtfd.zip" ? "rtfd" : ext];
export const categoryOf = category;

export function targetsFor(ext) {
  const base = TARGETS[category(ext)] ?? [];
  return [...base, ...(EXTRA_TARGETS[ext] ?? [])]
    .filter((t) => t !== ext && !(ext === "jpeg" && t === "jpg") && !(ext === "tif" && t === "tiff") && !(ext === "aif" && t === "aiff"));
}

export function defaultTarget(ext) {
  const t = targetsFor(ext);
  const d = DEFAULTS[ext === "rtfd.zip" ? "rtfd" : ext];
  return t.includes(d) ? d : t[0];
}

export const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  pdf: "application/pdf",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  epub: "application/epub+zip",
  fb2: "application/x-fictionbook+xml",
  tex: "application/x-tex",
  rst: "text/x-rst",
  adoc: "text/asciidoc",
  org: "text/org",
  typ: "text/plain",
  ipynb: "application/x-ipynb+json",
  dbk: "application/docbook+xml",
  wiki: "text/plain",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  numbers: "application/vnd.apple.numbers",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  tiff: "image/tiff",
  bmp: "image/bmp",
  ico: "image/x-icon",
  icns: "image/icns",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  aiff: "audio/aiff",
};
