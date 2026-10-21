// Bridge between the desktop shell and the web app (runs sandboxed, before the page).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("docshiftDesktop", {
  platform: process.platform,
  // cb receives [{ name, data: Uint8Array }] for files opened from the operating system
  onOpenFiles: (cb) => ipcRenderer.on("open-files", (_event, files) => cb(files)),
  ready: () => ipcRenderer.send("renderer-ready"),
});
