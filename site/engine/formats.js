// Catalog of every format DocShift understands.

// Input extension -> category. "document" and "slides" go through pandoc,
// "sheet" through SheetJS, "image" through the browser's canvas.
export const INPUTS = {
  // Documents
  docx: "document", odt: "document", rtf: "document", pdf: "document", pages: "document",
  epub: "document", html: "document", htm: "document", xhtml: "document",
  md: "document", markdown: "document", txt: "document", text: "document",
  tex: "document", latex: "document", rst: "document", org: "document", ipynb: "document",
  typ: "document", fb2: "document", adoc: "document", asciidoc: "document", textile: "document",
  opml: "document", dbk: "document", wiki: "document", djot: "document",
  // Presentations
  pptx: "slides", key: "slides", odp: "slides",
  // Spreadsheets
  xlsx: "sheet", xlsm: "sheet", xlsb: "sheet", xls: "sheet", ods: "sheet", fods: "sheet",
  numbers: "sheet", csv: "sheet", tsv: "sheet", dbf: "sheet",
  // Images
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", bmp: "image",
  svg: "image", avif: "image", ico: "image",
};

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
  tex: "LaTeX (.tex)",
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
};

// Which outputs make sense for each input category, in menu order
export const TARGETS = {
  document: ["docx", "pdf", "odt", "rtf", "html", "md", "txt", "epub", "tex", "pptx", "xlsx", "ods", "csv"],
  slides: ["pptx", "pdf", "docx", "odt", "html", "md", "txt"],
  sheet: ["xlsx", "csv", "pdf", "ods", "numbers", "xls", "tsv", "html", "json", "docx", "odt", "md", "txt"],
  image: ["png", "jpg", "webp", "pdf"],
};

// The "Windows-style" default for Apple formats, and a sensible default otherwise
const DEFAULTS = { pages: "docx", key: "pptx", numbers: "xlsx", pdf: "docx", docx: "pdf", pptx: "pdf", xlsx: "csv", csv: "xlsx", png: "jpg" };

// Old binary Office formats can't be read in the browser
export const UNSUPPORTED = {
  doc: "Old Word (.doc) files can't be read in the browser. Open it in Word or LibreOffice and save as .docx first.",
  ppt: "Old PowerPoint (.ppt) files can't be read in the browser. Save it as .pptx first.",
  heic: "HEIC photos aren't supported by browsers. Export the photo as JPEG first.",
};

export function inputExt(filename) {
  let name = filename.toLowerCase();
  // Finder-zipped packages: "Report.pages.zip"
  const m = name.match(/\.(pages|key|numbers)\.zip$/);
  if (m) return m[1];
  return name.includes(".") ? name.split(".").pop() : "";
}

export function targetsFor(ext) {
  return TARGETS[INPUTS[ext]]?.filter((t) => t !== ext && !(ext === "jpeg" && t === "jpg")) ?? [];
}

export function defaultTarget(ext) {
  const t = targetsFor(ext);
  return t.includes(DEFAULTS[ext]) ? DEFAULTS[ext] : t[0];
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
  tex: "application/x-tex",
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
};
