// Video and audio conversion with ffmpeg (WebAssembly).
// Streams are copied unchanged whenever the target container supports them (fast,
// lossless: e.g. an H.264 .mov from a Mac becomes .mp4 in seconds); otherwise they
// are re-encoded to the most widely playable codec for the target.
import { loadFFmpeg, resetFFmpeg } from "./libs.js";

export const VIDEO_OUTPUTS = ["mp4", "mov", "mkv", "webm", "avi", "gif"];
export const AUDIO_OUTPUTS = ["mp3", "m4a", "wav", "flac", "ogg", "aiff"];

// Which codecs each container can take as-is
const COPY_OK = {
  mp4: { video: ["h264"], audio: ["aac", "mp3"] },
  mov: { video: ["h264", "hevc", "prores"], audio: ["aac", "alac", "mp3", "pcm_s16le", "pcm_s16be", "pcm_s24le", "pcm_s24be"] },
  mkv: { video: ["h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "mpeg2video"], audio: ["aac", "mp3", "opus", "vorbis", "flac", "ac3", "alac"] },
  webm: { video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"] },
  avi: { video: [], audio: [] },
  mp3: { audio: ["mp3"] },
  m4a: { audio: ["aac", "alac"] },
  wav: { audio: ["pcm_s16le", "pcm_s24le"] },
  flac: { audio: ["flac"] },
  ogg: { audio: ["vorbis", "opus"] },
  aiff: { audio: ["pcm_s16be", "pcm_s24be"] },
};

// How to (re-)encode for each target
const ENCODE = {
  mp4: { video: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"], audio: ["-c:a", "aac", "-b:a", "160k"], extra: ["-movflags", "+faststart"] },
  mov: { video: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"], audio: ["-c:a", "aac", "-b:a", "160k"], extra: ["-movflags", "+faststart"] },
  mkv: { video: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"], audio: ["-c:a", "aac", "-b:a", "160k"], extra: [] },
  webm: { video: ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", "-crf", "10"], audio: ["-c:a", "libopus", "-b:a", "128k"], extra: [] },
  avi: { video: ["-c:v", "mpeg4", "-q:v", "4"], audio: ["-c:a", "libmp3lame", "-q:a", "2"], extra: [] },
  mp3: { audio: ["-c:a", "libmp3lame", "-q:a", "2"] },
  m4a: { audio: ["-c:a", "aac", "-b:a", "192k"] },
  wav: { audio: ["-c:a", "pcm_s16le"] },
  flac: { audio: ["-c:a", "flac"] },
  ogg: { audio: ["-c:a", "libvorbis", "-q:a", "5"] },
  aiff: { audio: ["-c:a", "pcm_s16be"] },
};

const EVEN_SIZE = "scale=trunc(iw/2)*2:trunc(ih/2)*2"; // H.264 needs even dimensions

// One job at a time: ffmpeg.wasm has a single virtual file system
let queue = Promise.resolve();

/**
 * @param {File} file
 * @param {string} target  output extension
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} options
 * @returns {Promise<Uint8Array>}
 */
export function convertMedia(file, target, options = {}) {
  const job = queue.then(async () => {
    try {
      return await run(file, target, options);
    } catch (e) {
      if (e.name === "AbortError" || !isCrash(e)) throw e;
      // ffmpeg.wasm can corrupt its memory after many jobs; it's unusable afterwards,
      // so start a fresh instance and try once more
      resetFFmpeg();
      try {
        return await run(file, target, options);
      } catch (e2) {
        if (isCrash(e2)) { resetFFmpeg(); throw new Error("The video engine crashed while converting this file."); }
        throw e2;
      }
    }
  });
  queue = job.catch(() => {});
  return job;
}

const isCrash = (e) => /RuntimeError|memory access out of bounds|unreachable|Aborted\(|table index/i.test(e.message);

async function run(file, target, { onProgress, signal }) {
  if (signal?.aborted) throw abortError();
  const ffmpeg = await loadFFmpeg();
  const logs = [];
  const onLog = ({ message }) => { logs.push(message); if (logs.length > 400) logs.shift(); };
  const onProg = ({ progress }) => { if (progress >= 0 && progress <= 1) onProgress?.(progress); };
  let aborted = false;
  const onAbort = () => { aborted = true; resetFFmpeg(); };
  signal?.addEventListener("abort", onAbort);
  ffmpeg.on("log", onLog);
  ffmpeg.on("progress", onProg);

  // Read the input in place (WORKERFS) instead of copying it into memory
  const dir = `/job${Date.now()}`, out = `/out.${target}`;
  const input = `${dir}/${file.name}`;
  try {
    await ffmpeg.createDir(dir);
    await ffmpeg.mount("WORKERFS", { files: [file] }, dir);

    // Probe: ffmpeg prints the streams, then fails for lack of an output
    logs.length = 0;
    await ffmpeg.exec(["-hide_banner", "-i", input]);
    const info = parseStreams(logs);
    if (!info.video && !info.audio) throw new Error("No video or audio was found in this file.");
    const wantsVideo = VIDEO_OUTPUTS.includes(target);
    if (wantsVideo && !info.video) throw new Error("This file has no video. Choose an audio format instead.");
    if (!wantsVideo && !info.audio) throw new Error("This file has no sound to convert.");

    const attempts = buildCommands(input, out, target, info);
    let ok = false;
    for (const args of attempts) {
      logs.length = 0;
      const code = await ffmpeg.exec(["-hide_banner", "-y", ...args]);
      if (aborted) throw abortError();
      if (code === 0) { ok = true; break; }
      try { await ffmpeg.deleteFile(out); } catch { /* nothing written */ }
    }
    if (!ok) throw new Error(`Couldn't convert this file: ${lastError(logs)}`);
    onProgress?.(1);
    return await ffmpeg.readFile(out);
  } catch (err) {
    if (aborted) throw abortError();
    // The ffmpeg worker reports some failures as plain strings
    const e = err instanceof Error ? err : new Error(String(err));
    if (/OOM|Cannot enlarge memory|Out of memory/i.test(e.message)) {
      resetFFmpeg();
      throw new Error("This file is too large to convert here (the limit is roughly 2 GB of video data).");
    }
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!aborted) {
      ffmpeg.off("log", onLog);
      ffmpeg.off("progress", onProg);
      try { await ffmpeg.deleteFile(out); } catch { /* ignore */ }
      try { await ffmpeg.unmount(dir); await ffmpeg.deleteDir(dir); } catch { /* ignore */ }
    }
  }
}

function abortError() {
  const e = new Error("Conversion cancelled.");
  e.name = "AbortError";
  return e;
}

function parseStreams(lines) {
  const info = { video: null, audio: null };
  for (const l of lines) {
    const m = /Stream #\d+:\d+.*?: (Video|Audio): (\w+)/.exec(l);
    if (!m) continue;
    if (m[1] === "Video" && !/attached pic/.test(l) && !info.video) info.video = m[2];
    if (m[1] === "Audio" && !info.audio) info.audio = m[2];
  }
  return info;
}

function lastError(lines) {
  const useful = lines.filter((l) => /error|invalid|unsupported|not supported|could not|failed/i.test(l) && !/^\s*$/.test(l));
  return (useful[useful.length - 1] || lines[lines.length - 1] || "unknown error").trim();
}

// Returns the commands to try in order: stream copy first when possible, then re-encode.
function buildCommands(input, out, target, info) {
  const meta = ["-map_metadata", "0"];
  if (target === "gif") {
    const fc = "[0:v]fps=12,scale='min(640,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer";
    return [["-i", input, "-filter_complex", fc, "-loop", "0", out]];
  }
  const ok = COPY_OK[target], enc = ENCODE[target];
  if (AUDIO_OUTPUTS.includes(target)) {
    const copy = ok.audio.includes(info.audio);
    const encode = ["-i", input, "-vn", "-map", "0:a:0", ...enc.audio, ...meta, out];
    return copy ? [["-i", input, "-vn", "-map", "0:a:0", "-c:a", "copy", ...meta, out], encode] : [encode];
  }
  // Video target
  const map = ["-map", "0:v:0", ...(info.audio ? ["-map", "0:a:0?"] : [])];
  const vCopy = ok.video.includes(info.video);
  const aCopy = !info.audio || ok.audio.includes(info.audio);
  const tag = target === "mov" || target === "mp4" ? (info.video === "hevc" ? ["-tag:v", "hvc1"] : []) : [];
  const v = vCopy ? ["-c:v", "copy", ...tag] : [...enc.video, ...(enc.video[1] === "libx264" ? ["-vf", EVEN_SIZE] : [])];
  const a = info.audio ? (aCopy ? ["-c:a", "copy"] : enc.audio) : [];
  const full = ["-i", input, ...map, ...enc.video, ...(enc.video[1] === "libx264" ? ["-vf", EVEN_SIZE] : []), ...(info.audio ? enc.audio : []), ...enc.extra, ...meta, out];
  if (!vCopy && !aCopy) return [full];
  return [["-i", input, ...map, ...v, ...a, ...enc.extra, ...meta, out], full];
}
