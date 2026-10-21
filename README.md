# DocShift

A free document converter that runs entirely in your browser. Files are never uploaded,
so it can be hosted as a static site on GitHub Pages.

| From | To |
|------|----|
| **Documents**: Pages, Word (.docx), PDF, OpenDocument (.odt), RTF, EPUB, HTML, Markdown, plain text, LaTeX, reStructuredText, Org, AsciiDoc, Jupyter, Typst | Word, PDF, OpenDocument, RTF, HTML, Markdown, text, EPUB, LaTeX, PowerPoint, Excel, ODS, CSV |
| **Presentations**: Keynote, PowerPoint (.pptx), OpenDocument (.odp) | PowerPoint, PDF, Word, OpenDocument, HTML, Markdown, text |
| **Spreadsheets**: Numbers, Excel (.xlsx/.xls/.xlsb/.xlsm), OpenDocument (.ods), CSV, TSV | Excel (.xlsx/.xls), CSV, PDF, ODS, Numbers, TSV, HTML, JSON, Word, Markdown, text |
| **Images**: PNG, JPEG, WebP, GIF, BMP, SVG, AVIF | PNG, JPEG, WebP, PDF |

## Install as an app

DocShift is a Progressive Web App, so it can be installed for free with no app store:

- **Windows, Mac, Linux, ChromeOS (Chrome or Edge):** click **Install app** on the page, or the install icon in the address bar.
  The app gets its own window and icon, and appears in "Open with" for supported file types.
- **Android (Chrome):** tap **Install app**, or ⋮ → **Install app**. Files shared from other apps
  (Share → DocShift) open straight in the converter.
- **iPhone / iPad (Safari):** tap **Share → Add to Home Screen**.

After the first use, the app works offline: the installed app downloads the document engine in the background.

## How it works

| Piece | Used for |
|-------|----------|
| [pandoc](https://pandoc.org) (WebAssembly, in a Web Worker) | Documents and presentations |
| [SheetJS](https://sheetjs.com) | Spreadsheets, including reading and writing Apple Numbers |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Reading text out of PDFs (paragraphs, headings and lists are rebuilt) |
| [pdfmake](http://pdfmake.org) + html-to-pdfmake | Creating PDFs |
| `site/engine/iwork.js` | Reading text from Pages and Keynote files (iWork 2013+ "IWA" format and the older iWork '09 XML format) |
| Browser canvas | Images |

Libraries load only when needed. The pandoc engine is a one-time ~16 MB download.
A service worker (`site/sw.js`) caches the app and its libraries for offline use. Library caches are keyed
by a hash of their contents, so updating only the app doesn't re-download the engine.

## Limitations

- Pages, Keynote and PDF inputs are converted as text and structure. Their layout and pictures are not kept.
- Scanned PDFs have no text layer, so there is nothing to extract.
- Converting a document to a spreadsheet keeps its tables. If it has none, you get one row per paragraph.
- PDF output uses one font (Roboto). It has no Chinese, Japanese or Korean glyphs.
- These are not supported: old binary `.doc`/`.ppt` files, Numbers '09 files, and password-protected files.

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

`.github/workflows/release.yml` publishes a GitHub Release, with the built site attached as a zip
that you can unzip onto any static web host. To cut a new release, bump `"version"` in
`package.json` and push to `main`. The workflow creates tag `v<version>` and the release if it doesn't exist yet.
You can also start it by hand from the Actions tab.

## Licenses

DocShift bundles pandoc (GPL-2.0-or-later), SheetJS and PDF.js (Apache-2.0), and pdfmake,
html-to-pdfmake, JSZip and browser_wasi_shim (MIT). The built site includes all of their
notices at `vendor/LICENSES.txt`.
