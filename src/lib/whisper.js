import { pipeline, env } from '@huggingface/transformers';

// Configure environment
env.allowLocalModels = false;
// Force single thread ONNX backend to prevent SharedArrayBuffer crashes on some browsers
env.backends.onnx.wasm.numThreads = 1;

let transcriber = null;

export async function loadWhisperModel(onProgress) {
  if (!transcriber) {
    onProgress({ stage: "Downloading Offline AI Model (approx 70MB - one time)...", pct: 0 });
    
    try {
      transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        progress_callback: (info) => {
          if (info.status === 'progress') {
             const pct = Math.round((info.loaded / info.total) * 100);
             onProgress({ stage: `Downloading Model: ${info.file}`, pct });
          }
        }
      });
    } catch (err) {
      throw new Error(`Failed to download AI model from HuggingFace. Network error: ${err.message}`);
    }
  }
  return transcriber;
}

export async function transcribeOffline(audioBlob, onProgress) {
  onProgress({ stage: "Loading AI Model...", pct: 0 });
  const model = await loadWhisperModel(onProgress);

  onProgress({ stage: "Decoding Audio for Transcription...", pct: 50 });
  
  const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const arrayBuffer = await audioBlob.arrayBuffer();
  
  let audioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch (err) {
    throw new Error("Could not decode audio from the provided file. The format might be unsupported.");
  }
  
  const audioData = audioBuffer.getChannelData(0);

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
