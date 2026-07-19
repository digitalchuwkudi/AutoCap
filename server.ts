import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Provide necessary headers for SharedArrayBuffer (ffmpeg.wasm)
  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  });

  // Increase payload limit for video/audio file base64 uploads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // AI Studio automatically provides process.env.GEMINI_API_KEY
  // This endpoint keeps the key securely on the server.
  app.post("/api/transcribe", async (req, res) => {
    try {
      const { mimeType, base64Data } = req.body;
      
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing from the environment.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const prompt = `You are a precise speech transcription engine.
Transcribe every spoken word in this media file.
Return ONLY a valid JSON array. No markdown, no explanation, nothing else before or after.
Each element: {"word":"string","start":0.00,"end":0.00}
Times in seconds, 2 decimal places.
Include every word, even short ones like "a", "the", "um", "uh".`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: prompt }
            ]
          }
        ],
        config: {
          temperature: 0,
        }
      });

      let raw = response.text || "";
      const clean = raw.replace(/```json\s*|```\s*/g, "").trim();

      let words;
      try {
        words = JSON.parse(clean);
      } catch (e) {
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) {
          words = JSON.parse(match[0]);
        } else {
          throw new Error("Could not parse Gemini response. Output was: " + raw.substring(0, 100));
        }
      }

      if (!Array.isArray(words) || words.length === 0) {
        throw new Error("No words found in transcript.");
      }

      res.json({ words });
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ error: error.message || "Failed to transcribe audio/video." });
    }
  });

  // Translation endpoint
  app.post("/api/translate", async (req, res) => {
    try {
      const { captions, targetLanguage } = req.body;
      
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing from the environment.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const prompt = `Translate the following JSON array of video captions to ${targetLanguage}.
You MUST maintain the exact same JSON structure.
You MUST NOT change the 'id', 'start', 'end', or 'words' keys.
ONLY translate the "text" values.
Return ONLY a valid JSON array. Do not wrap it in markdown.
Input: ${JSON.stringify(captions)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt }
            ]
          }
        ],
        config: {
          temperature: 0,
        }
      });

      let raw = response.text || "";
      const clean = raw.replace(/```json\s*|```\s*/g, "").trim();

      let translated;
      try {
        translated = JSON.parse(clean);
      } catch (e) {
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) {
          translated = JSON.parse(match[0]);
        } else {
          throw new Error("Could not parse Gemini translation response.");
        }
      }

      res.json({ translated });
    } catch (error: any) {
      console.error("Translation error:", error);
      res.status(500).json({ error: error.message || "Failed to translate captions." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
