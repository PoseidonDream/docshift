# DocShift

A free file converter that turns Mac files into Windows files and back: documents, spreadsheets,
presentations, photos, video and audio. Everything runs on your device, and files are never uploaded.
It's available as a website (GitHub Pages), an installable app, and desktop apps for Windows, macOS and Linux.

## Mac ⇄ Windows

| Mac file | Windows / universal file |
|---|---|
| Pages (.pages) | Word (.docx), PDF |
| Numbers (.numbers) | Excel (.xlsx), CSV |
| Keynote (.key) | PowerPoint (.pptx), PDF |
| iPhone/Mac photo (.heic) | JPEG, PNG |
| QuickTime video (.mov) | MP4 |
| Apple audio (.m4a, .aiff, .caf) | MP3, WAV |
| Mac icon (.icns) | Windows icon (.ico), PNG |
| Safari web archive (.webarchive) | PDF, Word, HTML |
| TextEdit document (.rtfd, zipped) | Word, PDF |

The other way, DocShift writes Numbers, MOV, AIFF, M4A and ICNS files. It can't write Pages and Keynote files,
because only Apple's apps can create them, but Pages opens .docx and Keynote opens .pptx directly.

## All formats

| From | To |
|------|----|
| **Documents**: Pages, Word (.docx), PDF, OpenDocument (.odt), RTF, TextEdit .rtfd, Safari .webarchive, EPUB, HTML, Markdown, plain text, LaTeX, reStructuredText, Org, AsciiDoc, Jupyter, Typst, FictionBook, DocBook | Word, PDF, OpenDocument, RTF, HTML, Markdown, text, EPUB, FictionBook, LaTeX, reStructuredText, AsciiDoc, Org, Typst, Jupyter, DocBook, MediaWiki, PowerPoint, Excel, ODS, CSV |
| **Presentations**: Keynote, PowerPoint (.pptx), OpenDocument (.odp) | PowerPoint, PDF, Word, OpenDocument, HTML, Markdown, text |
| **Spreadsheets**: Numbers, Excel (.xlsx/.xls/.xlsb/.xlsm), OpenDocument (.ods), CSV, TSV, JSON | Excel (.xlsx/.xls), CSV, PDF, ODS, Numbers, TSV, HTML, JSON, Word, Markdown, text |
| **Images**: HEIC/HEIF, PNG, JPEG, WebP, GIF, TIFF (multi-page), BMP, SVG, AVIF, ICO, ICNS | JPEG, PNG, WebP, PDF, TIFF, BMP, ICO, ICNS; animated GIF → MP4/WebM |
| **Video**: MOV, MP4, M4V, MKV, WebM, AVI, WMV, FLV, 3GP, MPEG, MTS/M2TS, OGV | MP4, MOV, MKV, WebM, AVI, animated GIF; audio as MP3, M4A, WAV |
| **Audio**: MP3, M4A, AAC, WAV, AIFF, CAF, FLAC, OGG, Opus, WMA, AMR | MP3, M4A, WAV, FLAC, OGG, AIFF |

## Install as an app

DocShift is a Progressive Web App, so it can be installed for free with no app store:

- **Windows, Mac, Linux, ChromeOS (Chrome or Edge):** click **Install app** on the page, or the install icon in the address bar.
  The app gets its own window and icon, and appears in "Open with" for supported file types.
- **Android (Chrome):** tap **Install app**, or ⋮ → **Install app**. Files shared from other apps
  (Share → DocShift) open straight in the converter.
- **iPhone / iPad (Safari):** tap **Share → Add to Home Screen**.

After the first use, the app works offline: the installed app downloads the document engine in the background.

## Desktop apps (Windows, macOS, Linux)

Each [GitHub Release](https://github.com/PoseidonDream/docshift/releases/latest) includes installers:

| System | File |
|---|---|
| Windows 10/11 (x64) | `DocShift-Windows-Setup.exe` |
| macOS 11+ (Apple Silicon and Intel) | `DocShift-macOS.dmg` |
| Linux (x64) | `DocShift-Linux.AppImage` (any distro) or `DocShift-Linux.deb` (Ubuntu/Debian) |

The desktop app is the same web app packaged with [Electron](https://www.electronjs.org/) (`desktop/`).
It works fully offline, and you can open files from the file manager with it ("Open with DocShift").
The installers aren't signed with a paid certificate, so Windows SmartScreen and macOS Gatekeeper show
a warning on first launch. The download page and release notes explain how to proceed.

To build locally: `npm install && npm run build`, then in `desktop/`: `npm install && npm run dist`
(installers land in `desktop/release/`). `npm start` in `desktop/` runs the app without packaging.

## How it works

| Piece | Used for |
|-------|----------|
| [pandoc](https://pandoc.org) (WebAssembly, in a Web Worker) | Documents and presentations |
| [SheetJS](https://sheetjs.com) | Spreadsheets, including reading and writing Apple Numbers |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Reading text out of PDFs (paragraphs, headings and lists are rebuilt) |
| [pdfmake](http://pdfmake.org) + html-to-pdfmake | Creating PDFs |
| `site/engine/iwork.js` | Reading text from Pages and Keynote files (iWork 2013+ "IWA" format and the older iWork '09 XML format) |
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) | Video and audio. Streams are copied when the target container supports them, and re-encoded otherwise |
| [libheif](https://github.com/catdad-experiments/libheif-js) | HEIC/HEIF photos |
| [UTIF.js](https://github.com/photopea/UTIF.js) | TIFF images |
| `site/engine/images.js` | ICO, ICNS and BMP encoding, plus ICNS decoding |
| `site/engine/webarchive.js` | Safari web archives (binary property lists) |
| Browser canvas | Other images |

Libraries load only when needed. The pandoc engine (~16 MB) and the ffmpeg engine (~10 MB) are one-time downloads.
A service worker (`site/sw.js`) caches the app and its libraries for offline use. Library caches are keyed
by a hash of their contents, so updating only the app doesn't re-download the engine.

## Limitations

- Pages, Keynote and PDF inputs are converted as text and structure. Their layout and pictures are not kept.
- Scanned PDFs have no text layer, so there is nothing to extract.
- Converting a document to a spreadsheet keeps its tables. If it has none, you get one row per paragraph.
- PDF output uses one font (Roboto). It has no Chinese, Japanese or Korean glyphs.
- These are not supported: old binary `.doc`/`.ppt` files, Numbers '09 files, and password-protected files.
- Video is converted with a WebAssembly build of ffmpeg on a single CPU thread. When the codec stays the same
  (for example H.264 .mov → .mp4), conversion takes seconds. Re-encoding, for example iPhone HEVC → H.264 MP4,
  takes about 4–5× the video's length. Files up to roughly 2 GB work.
- HEIC can be read but not written: browsers have no HEVC encoder.

## Develop

    npm install
    npm run build      # writes the static site to dist/
    npm run serve      # http://localhost:8080

Source lives in `site/`. `scripts/build.mjs` copies it to `dist/` along with the browser builds of the libraries. There is no bundler.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` builds and publishes the site (`.github/workflows/deploy.yml`).
   It appears at `https://<user>.github.io/<repo>/`.

## Releases

`.github/workflows/release.yml` builds the desktop apps on Windows, macOS and Linux and smoke-tests
each one on its own OS (`desktop/smoke-test.mjs`). It then publishes a GitHub Release with the installers,
plus the website as a zip that you can unzip onto any static web host. A release is only created if all
three builds pass. To cut a new release, bump `"version"` in
`package.json` and push to `main`. The workflow creates tag `v<version>` and the release if it doesn't exist yet.
You can also start it by hand from the Actions tab.

## Licenses

DocShift bundles pandoc (GPL-2.0-or-later), SheetJS and PDF.js (Apache-2.0), and pdfmake,
html-to-pdfmake, JSZip and browser_wasi_shim (MIT). The built site includes all of their
notices at `vendor/LICENSES.txt`.
