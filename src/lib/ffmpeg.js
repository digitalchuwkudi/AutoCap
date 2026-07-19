// Burns captions into video using FFmpeg.wasm.
// Runs ENTIRELY in the browser. No server. No upload. Free.
// First call downloads ~31MB of FFmpeg engine (cached after that).
// File size limit: ~500MB depending on your RAM.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ff       = null;
let ffLoaded = false;

export async function loadFFmpeg(onProgress) {
  if (ffLoaded) return ff;

  onProgress?.({ stage: "Downloading FFmpeg engine (~31MB, one time only)…", pct: 0, overall: 5 });

  ff = new FFmpeg();

  // Log FFmpeg output to browser console for debugging
  ff.on("log", ({ message }) => console.debug("[ffmpeg]", message));

  // Real-time render progress
  ff.on("progress", ({ progress }) => {
    onProgress?.({
      stage:   "Rendering…",
      pct:     Math.round(progress * 100),
      overall: Math.round(40 + progress * 55),
    });
  });

  // Download files manually to blobs to ensure they are fully downloaded before WebAssembly compilation
  // This prevents CompileErrors caused by chunked streaming or timeouts in sandboxed environments.
  const loadBlob = async (url, type) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return URL.createObjectURL(new Blob([buf], { type }));
    } catch (e) {
      throw new Error(`Failed to fetch ${url}: ${e.message || e}`);
    }
  };

  try {
    const coreURL = await loadBlob("/ffmpeg/ffmpeg-core.js?v=2", "text/javascript");
    const wasmURL = await loadBlob("/ffmpeg/ffmpeg-core.wasm?v=2", "application/wasm");

    await ff.load({ coreURL, wasmURL });
  } catch (err) {
    throw new Error(`Failed to load FFmpeg engine. Network error or adblocker might be blocking it. Detailed error: ${err?.message || err}`);
  }

  ffLoaded = true;
  return ff;
}

export async function extractAudio(mediaFile, onProgress) {
  const engine = await loadFFmpeg(p => onProgress?.(p));
  onProgress?.({ stage: "Extracting audio for fast AI transcription…", pct: 0, overall: 10 });
  
  await engine.writeFile("input_media", await fetchFile(mediaFile));
  
  onProgress?.({ stage: "Processing audio track…", pct: 50, overall: 20 });
  // -vn removes video, -acodec pcm_s16le extracts uncompressed WAV (fully supported & fast)
  await engine.exec([
    "-i", "input_media",
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "audio.wav"
  ]);
  
  const audioData = await engine.readFile("audio.wav");
  
  await engine.deleteFile("input_media").catch(() => {});
  await engine.deleteFile("audio.wav").catch(() => {});
  
  return new File([audioData.buffer], "audio.wav", { type: "audio/wav" });
}

// Converts hex color to ASS subtitle format (&HAABBGGRR)
function hexToASS(hex, alpha = 0) {
  const c = (hex || "#000000").replace("#", "").padStart(6, "0");
  const r = parseInt(c.slice(0,2), 16);
  const g = parseInt(c.slice(2,4), 16);
  const b = parseInt(c.slice(4,6), 16);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `&H${[a,b,g,r].map(n => n.toString(16).padStart(2,"0").toUpperCase()).join("")}`;
}

function toASSTime(s) {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  return `${h}:${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
}

// Builds an ASS subtitle file from captions + style config.
// ASS format gives us full control over font, color, size, position, outline.
export function buildASS(captions, style, dims = { width: 1080, height: 1920 }) {
  const { width, height } = dims;

  const fontName  = (style.font || "DM Sans").replace(/'/g, "").trim();
  const fontSize  = Math.round((style.fontSize || 22) * (height / 640));
  const bold      = (style.fontWeight || 700) >= 700 ? -1 : 0;
  const primary   = hexToASS(style.color || "#ffffff", 0);
  const outline   = hexToASS(style.strokeColor || "#000000", 0);
  const outlineW  = style.stroke ? (style.strokeWidth || 2) : 0;
  const shadow    = style.shadow ? 1 : 0;
  const backColor = style.bg
    ? hexToASS("#000000", 1 - (style.bgOpacity || 70) / 100)
    : "&H00000000";

  const marginV =
    style.position === "top"    ? Math.round(height * 0.08) :
    style.position === "center" ? Math.round(height * 0.45) :
                                  Math.round(height * 0.10);

  const alignment =
    style.position === "top"    ? 8 :
    style.position === "center" ? 5 : 2;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},${primary},${primary},${outline},${backColor},${bold},0,0,0,100,100,0,0,1,${outlineW},${shadow},${alignment},40,40,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = captions.map(c => {
    const text = c.text
      .replace(/\\/g, "\\\\")
      .replace(/\{/g, "\\{")
      .replace(/\n/g, "\\N");
    return `Dialogue: 0,${toASSTime(c.start)},${toASSTime(c.end)},Default,,0,0,0,,${text}`;
  });

  return [header, ...events].join("\n");
}

// Main burn function — takes a video File + captions + style, returns a Blob
export async function burnCaptionsToVideo(videoFile, captions, style, onProgress) {
  const engine = await loadFFmpeg(p => onProgress?.(p));

  onProgress?.({ stage: "Loading video into memory…", pct: 0, overall: 20 });
  await engine.writeFile("input.mp4", await fetchFile(videoFile));

  onProgress?.({ stage: "Building subtitle file…", pct: 0, overall: 35 });
  const assText = buildASS(captions, style);
  await engine.writeFile("captions.ass", new TextEncoder().encode(assText));

  onProgress?.({ stage: "Rendering video…", pct: 0, overall: 40 });

  // Quality settings
  const crf    = style.quality === "draft" ? "28" : style.quality === "hq" ? "16" : "22";
  const preset = style.quality === "draft" ? "ultrafast" : style.quality === "hq" ? "medium" : "fast";

  // FFmpeg command:
  // -vf ass=captions.ass  → burn subtitle using ASS renderer (full styling)
  // -c:v libx264          → re-encode video with captions baked in
  // -c:a copy             → copy audio unchanged (fast, no quality loss)
  // -movflags +faststart  → optimise MP4 for web playback
  await engine.exec([
    "-i",        "input.mp4",
    "-vf",       "ass=captions.ass",
    "-c:v",      "libx264",
    "-crf",      crf,
    "-preset",   preset,
    "-c:a",      "copy",
    "-movflags", "+faststart",
    "-y",        "output.mp4",
  ]);

  onProgress?.({ stage: "Finalising…", pct: 98, overall: 97 });

  const outputData = await engine.readFile("output.mp4");

  // Clean up FFmpeg virtual filesystem
  await engine.deleteFile("input.mp4").catch(() => {});
  await engine.deleteFile("captions.ass").catch(() => {});
  await engine.deleteFile("output.mp4").catch(() => {});

  onProgress?.({ stage: "Done!", pct: 100, overall: 100 });

  return new Blob([outputData.buffer], { type: "video/mp4" });
}

// Triggers a browser download of the rendered video
export function downloadBlob(blob, filename = "autocap-output.mp4") {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
