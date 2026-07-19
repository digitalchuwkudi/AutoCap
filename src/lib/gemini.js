// Sends your video/audio to Gemini and gets back word-level timestamps.
// Uses the FREE tier — no billing required for personal use.

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function transcribeWithGemini(file, onStatus) {
  onStatus("Reading file…");
  const base64 = await fileToBase64(file);

  onStatus("Sending to Server…");
  
  // Using the secure backend proxy so the API key stays hidden
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mimeType: file.type,
      base64Data: base64
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Server error ${response.status}`);
  }

  onStatus("Parsing transcript…");
  const data = await response.json();
  return data.words;
}

// Groups word array into caption blocks of N words each
export function groupIntoCaptions(words, perBlock = 6) {
  const blocks = [];
  for (let i = 0; i < words.length; i += perBlock) {
    const chunk = words.slice(i, i + perBlock);
    if (!chunk.length) continue;
    blocks.push({
      id:    `cap-${blocks.length}-${Date.now()}`,
      text:  chunk.map(w => w.word).join(" "),
      start: chunk[0].start,
      end:   chunk[chunk.length - 1].end,
      words: chunk,
    });
  }
  return blocks;
}

export async function translateCaptions(captions, targetLanguage, onStatus) {
  onStatus(`Translating to ${targetLanguage}…`);
  
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      captions,
      targetLanguage
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Server error ${response.status}`);
  }

  const data = await response.json();
  return data.translated;
}

