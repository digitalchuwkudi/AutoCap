// Builds and downloads SRT, VTT, and TXT files.
// Pure browser — no server needed.

function toSRTTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms  = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}

function toVTTTime(s) {
  return toSRTTime(s).replace(",", ".");
}

export function buildSRT(captions) {
  return captions
    .map((c, i) => `${i+1}\n${toSRTTime(c.start)} --> ${toSRTTime(c.end)}\n${c.text}`)
    .join("\n\n");
}

export function buildVTT(captions) {
  return "WEBVTT\n\n" + captions
    .map((c, i) => `${i+1}\n${toVTTTime(c.start)} --> ${toVTTTime(c.end)}\n${c.text}`)
    .join("\n\n");
}

export function buildTXT(captions) {
  return captions.map(c => c.text).join("\n");
}

export function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function fmtTime(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
