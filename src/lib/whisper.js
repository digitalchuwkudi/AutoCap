import { pipeline, env } from '@huggingface/transformers';

// Configure environment
env.allowLocalModels = false;

let transcriber = null;

export async function loadWhisperModel(onProgress) {
  if (!transcriber) {
    onProgress({ stage: "Downloading Offline AI Model (approx 70MB - one time)...", pct: 0 });
    
    // Using whisper-tiny.en for fast, entirely offline in-browser transcription
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: (info) => {
        if (info.status === 'progress') {
           const pct = Math.round((info.loaded / info.total) * 100);
           onProgress({ stage: `Downloading Model: ${info.file}`, pct });
        }
      }
    });
  }
  return transcriber;
}

export async function transcribeOffline(audioBlob, onProgress) {
  onProgress({ stage: "Loading AI Model...", pct: 0 });
  const model = await loadWhisperModel(onProgress);

  onProgress({ stage: "Decoding Audio for Transcription...", pct: 50 });
  
  // Decode the audio to raw PCM (Float32Array) at 16kHz for Whisper
  const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const audioData = audioBuffer.getChannelData(0); // Float32Array

  onProgress({ stage: "Transcribing Offline (this may take a moment)...", pct: 75 });
  
  // Transcribe with word-level timestamps
  const output = await model(audioData, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: 'word',
  });

  const chunks = output.chunks || [];
  
  // Map Whisper output to our application's format
  const words = [];
  for (const chunk of chunks) {
     if (chunk.timestamp && chunk.text) {
       words.push({
         word: chunk.text.trim(),
         start: chunk.timestamp[0],
         end: chunk.timestamp[1] || chunk.timestamp[0] + 0.5,
       });
     }
  }

  if (words.length === 0) {
     throw new Error("No words detected in audio.");
  }

  return words;
}
