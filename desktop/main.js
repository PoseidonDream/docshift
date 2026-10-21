// DocShift desktop app: the same web app, served from inside the package.
// Pages load from a private app:// origin (ES modules, workers and WebAssembly need a
// real origin, which file:// isn't). Nothing is fetched from the internet.
const { app, BrowserWindow, protocol, shell, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const WEB_ROOT = path.join(__dirname, "web");
const ORIGIN = "app://docshift";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".gz": "application/gzip",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

async function serve(request) {
  let rel = decodeURIComponent(new URL(request.url).pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(WEB_ROOT, rel));
  if (!file.startsWith(WEB_ROOT + path.sep)) return new Response("Forbidden", { status: 403 });
  try {
    const data = await fs.promises.readFile(file);
    return new Response(data, {
      headers: { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Content-Length": String(data.length) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// ---- files opened from the OS ("Open with DocShift", double-click, drag onto the icon) ----
let mainWindow = null;
let rendererReady = false;
const pendingPaths = [];

function filesFromArgv(argv) {
  return argv.slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith("-") && path.isAbsolute(path.resolve(a)))
    .map((a) => path.resolve(a))
    .filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

async function openPaths(paths) {
  if (!paths.length) return;
  if (!mainWindow || !rendererReady) { pendingPaths.push(...paths); return; }
  const files = [];
  for (const p of paths) {
    try { files.push({ name: path.basename(p), data: await fs.promises.readFile(p) }); } catch { /* unreadable: skip */ }
  }
  if (files.length) mainWindow.webContents.send("open-files", files);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

ipcMain.on("renderer-ready", () => {
  rendererReady = true;
  openPaths(pendingPaths.splice(0));
});

// macOS delivers opened files through this event (possibly before the app is ready)
app.on("open-file", (event, filePath) => { event.preventDefault(); openPaths([filePath]); });

// Windows/Linux: a second launch (e.g. "Open with" while running) hands its files to this one
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => openPaths(filesFromArgv(argv)));
  pendingPaths.push(...filesFromArgv(process.argv));
}

// ---- windows ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 380,
    minHeight: 480,
    title: "DocShift",
    backgroundColor: "#f3f4f6",
    autoHideMenuBar: true,
    icon: path.join(WEB_ROOT, "icons/icon-512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  rendererReady = false;

  const { webContents } = mainWindow;
  // Web links open in the user's browser; other app pages (e.g. licenses) in a new window
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${ORIGIN}/`) && new URL(url).pathname === "/") return; // reload
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
    else if (url.startsWith(`${ORIGIN}/`)) {
      const child = new BrowserWindow({ width: 800, height: 700, parent: mainWindow, autoHideMenuBar: true });
      child.loadURL(url);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(`${ORIGIN}/`);
}

if (primaryInstance) app.whenReady().then(() => {
  protocol.handle("app", serve);
  // Converted files: show a Save dialog that starts in the Downloads folder
  session.defaultSession.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
  });
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
