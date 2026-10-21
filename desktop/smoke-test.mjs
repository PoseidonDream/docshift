// Launches a packaged DocShift build and checks that it works end to end:
// a file passed on the command line ("Open with") shows up, and conversions through
// every engine (pandoc, PDF output, spreadsheets, images) succeed.
// Usage: node smoke-test.mjs <path to the app executable>
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) {
  console.error(`App executable not found: ${exe}`);
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docshift-test-"));
const openedFile = path.join(dir, "opened from OS.md");
fs.writeFileSync(openedFile, "# Hello\n\nOpened from the command line.\n");

const args = [openedFile];
// Chromium's sandbox can't run as root or on CI runners; real users keep it
if (process.platform === "linux" && (process.getuid() === 0 || process.env.CI)) args.unshift("--no-sandbox");

const app = await electron.launch({ executablePath: exe, args, timeout: 60000 });
const failures = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.waitForSelector(".row .name", { timeout: 30000 });
  const queued = await page.$$eval(".row .name", (n) => n.map((x) => x.textContent));
  console.log("Opened via command line:", queued);
  if (!queued.includes("opened from OS.md")) failures.push("file passed on the command line did not open");

  const results = await page.evaluate(async () => {
    const { convertFile } = await import("./engine/convert.js");
    const text = async (blob) => new TextDecoder().decode(await blob.arrayBuffer());
    const head = async (blob, n) => text(blob.slice(0, n));
    const out = {};
    const run = async (name, fn) => {
      try { out[name] = await fn(); } catch (e) { out[name] = `FAILED: ${e.message}`; }
    };
    const md = new File(["# Report\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"], "report.md");
    let docx;
    await run("md -> docx", async () => { docx = (await convertFile(md, "docx")).blob; return (await head(docx, 2)) === "PK" ? "ok" : "bad zip"; });
    await run("docx -> pdf", async () => (await head((await convertFile(new File([docx], "report.docx"), "pdf")).blob, 5)) === "%PDF-" ? "ok" : "bad pdf");
    await run("docx -> md", async () => (await text((await convertFile(new File([docx], "report.docx"), "md")).blob)).includes("two") ? "ok" : "text missing");
    let xlsx;
    await run("csv -> xlsx", async () => { xlsx = (await convertFile(new File(["name,value\napple,3\n"], "data.csv"), "xlsx")).blob; return "ok"; });
    await run("xlsx -> csv", async () => (await text((await convertFile(new File([xlsx], "data.xlsx"), "csv")).blob)).includes("apple,3") ? "ok" : "data missing");
    await run("svg -> png", async () => {
      const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'], "a.svg");
      return (await convertFile(svg, "png")).blob.type === "image/png" ? "ok" : "not png";
    });
    return out;
  });
  for (const [name, r] of Object.entries(results)) {
    console.log(`${r === "ok" ? "PASS" : "FAIL"} ${name}${r === "ok" ? "" : `: ${r}`}`);
    if (r !== "ok") failures.push(`${name}: ${r}`);
  }
} finally {
  await app.close();
}
if (failures.length) {
  console.error("Smoke test failed:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("Smoke test passed.");
