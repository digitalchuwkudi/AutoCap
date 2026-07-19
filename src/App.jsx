import { useState, useEffect, useRef, useCallback } from "react";
import { transcribeOffline } from "./lib/whisper.js";
import { groupIntoCaptions } from "./lib/gemini.js";
import { buildSRT, buildVTT, buildTXT, downloadText, fmtTime } from "./lib/export.js";
import { burnCaptionsToVideo, downloadBlob, extractAudio } from "./lib/ffmpeg.js";

// ── Constants ──────────────────────────────────────────────────────────────────
const COLORS = ["#ffffff","#ffd700","#ff6b6b","#74c0fc","#69db7c","#da77f2","#ff9f43","#a9e34b","#f8f9fa","#adb5bd"];

const ANIMATIONS = [
  { id:"pop",        label:"Pop",      icon:"💥" },
  { id:"slide",      label:"Slide",    icon:"↑"  },
  { id:"fade",       label:"Fade",     icon:"◐"  },
  { id:"bounce",     label:"Bounce",   icon:"⤴"  },
  { id:"zoom",       label:"Zoom",     icon:"⊕"  },
  { id:"typewriter", label:"Type",     icon:"▌"  },
];

const HIGHLIGHTS = [
  { id:"box",       label:"Box"       },
  { id:"underline", label:"Underline" },
  { id:"glow",      label:"Glow"      },
  { id:"color",     label:"Color"     },
  { id:"scale",     label:"Scale"     },
  { id:"none",      label:"None"      },
];

const FONTS = [
  ["'DM Sans'",        "DM Sans"    ],
  ["'Bebas Neue'",     "Bebas Neue" ],
  ["Impact",           "Impact"     ],
  ["Georgia",          "Georgia"    ],
  ["'JetBrains Mono'", "Monospace"  ],
  ["Arial",            "Arial"      ],
];

const QUALITY = [
  { id:"draft",    label:"Draft",    crf:28, note:"Fast render" },
  { id:"balanced", label:"Balanced", crf:22, note:"Best of both" },
  { id:"hq",       label:"HQ",       crf:16, note:"Best quality" },
];

const FORMATS   = ["9:16","16:9","1:1"];
const POSITIONS = ["bottom","center","top"];

const DEMO = [
  { id:"d0", text:"Welcome to AutoCap your AI caption studio",           start:0.0,  end:2.5  },
  { id:"d1", text:"Upload any video and Gemini transcribes it instantly", start:2.5,  end:5.5  },
  { id:"d2", text:"Style your captions with colors and animations",      start:5.5,  end:8.5  },
  { id:"d3", text:"Six animations pop slide fade bounce zoom typewriter", start:8.5,  end:12.0 },
  { id:"d4", text:"Highlight words as they are spoken on screen",        start:12.0, end:15.0 },
  { id:"d5", text:"Export SRT VTT or burn captions into your video",     start:15.0, end:18.5 },
  { id:"d6", text:"Runs entirely in your browser no server needed",      start:18.5, end:22.0 },
  { id:"d7", text:"Built for YouTube automation creators like you",      start:22.0, end:25.5 },
];

const DEFAULT_STYLE = {
  color:"#ffffff", font:"'DM Sans'", fontSize:22, fontWeight:700,
  animation:"pop", stroke:true, strokeWidth:2, strokeColor:"#000000",
  shadow:true, bg:false, bgOpacity:70, letterSpacing:0,
  position:"bottom", quality:"balanced",
};

// ── Tiny atoms ─────────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }) {
  return <div className={`ac-toggle${on ? " on" : ""}`} onClick={onToggle} />;
}

function Slider({ min, max, step = 1, value, onChange, unit = "" }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)} />
      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11,
        color:"var(--t2)", minWidth:32, textAlign:"right" }}>
        {value}{unit}
      </span>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      {children}
    </div>
  );
}

function Label({ children }) {
  return <div className="section-label">{children}</div>;
}

function ProgressBar({ pct, color = "var(--white)" }) {
  return (
    <div style={{ height:4, background:"var(--s4)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${pct}%`, background:color,
        borderRadius:2, transition:"width .3s ease" }} />
    </div>
  );
}

// ── Caption word display ────────────────────────────────────────────────────────
function CaptionDisplay({ caption, style, highlight }) {
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (!caption) return;
    setActiveIdx(-1);
    const words  = caption.text.split(" ");
    const timers = words.map((_, i) => setTimeout(() => setActiveIdx(i), i * 145));
    return () => timers.forEach(clearTimeout);
  }, [caption?.id, caption?.text]);

  if (!caption) return null;

  const words = caption.text.split(" ");

  return (
    <div className={`anim-${style.animation || "pop"}`}
      style={{ textAlign:"center", padding:"0 16px" }}>
      {words.map((word, i) => {
        const isActive = i === activeIdx;
        const hl = {};
        if (isActive) {
          if (highlight === "box")       { hl.background = "rgba(255,255,255,.18)"; hl.borderRadius = 4; hl.padding = "1px 4px"; }
          if (highlight === "underline") { hl.textDecoration = "underline"; hl.textUnderlineOffset = "3px"; }
          if (highlight === "glow")      { hl.textShadow = `0 0 16px ${style.color}, 0 0 32px ${style.color}88`; }
          if (highlight === "color")     { hl.color = "#ffd700"; }
          if (highlight === "scale")     { hl.display = "inline-block"; hl.transform = "scale(1.18)"; }
        }
        return (
          <span key={`${caption.id}-w${i}`} className="cap-word" style={{
            display:          "inline-block",
            margin:           "0 2px",
            fontFamily:       style.font || "'DM Sans'",
            fontSize:         style.fontSize || 22,
            fontWeight:       style.fontWeight || 700,
            color:            style.color || "#ffffff",
            lineHeight:       1.3,
            letterSpacing:    style.letterSpacing || 0,
            WebkitTextStroke: style.stroke
              ? `${style.strokeWidth || 2}px ${style.strokeColor || "#000"}`
              : "none",
            textShadow: style.shadow ? "0 2px 12px rgba(0,0,0,.9)" : "none",
            animationDelay:   `${i * 0.13}s`,
            transition:       "transform .1s, color .1s",
            ...hl,
          }}>{word}</span>
        );
      })}
    </div>
  );
}

// ── Upload zone ─────────────────────────────────────────────────────────────────
function UploadZone({ onFile, disabled }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();

  const handle = (file) => {
    if (!file || disabled) return;
    if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
      alert("Please upload a video or audio file (MP4, MOV, MP3, WAV, M4A).");
      return;
    }
    onFile(file);
  };

  return (
    <div
      className={drag ? "drag-active" : ""}
      onClick={() => !disabled && ref.current?.click()}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      style={{
        margin:"12px 12px 6px", padding:"20px 14px",
        border:"1.5px dashed var(--b3)", borderRadius:10, textAlign:"center",
        cursor: disabled ? "not-allowed" : "pointer",
        transition:"border-color .2s, background .2s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ fontSize:22, marginBottom:6 }}>🎬</div>
      <div style={{ fontWeight:600, fontSize:13, marginBottom:3 }}>Drop video or audio</div>
      <div style={{ color:"var(--t2)", fontSize:11.5 }}>MP4 · MOV · MP3 · WAV · M4A</div>
      <input ref={ref} type="file" accept="video/*,audio/*"
        style={{ display:"none" }}
        onChange={e => handle(e.target.files[0])} />
    </div>
  );
}

// ── Main application ────────────────────────────────────────────────────────────
export default function App() {
  const [captions,      setCaptions]      = useState(DEMO);
  const [selectedIdx,   setSelectedIdx]   = useState(0);
  const [videoFile,     setVideoFile]     = useState(null);
  const [audioBlob,     setAudioBlob]     = useState(null);
  const waveformCanvasRef = useRef(null);
  const [loading,       setLoading]       = useState(false);
  const [loadStatus,    setLoadStatus]    = useState("");
  const [loadError,     setLoadError]     = useState("");
  const [currentTime,   setCurrentTime]   = useState(0);
  const [playing,       setPlaying]       = useState(false);
  const [videoFormat,   setVideoFormat]   = useState("9:16");
  const [editText,      setEditText]      = useState(DEMO[0].text);
  const [wordsPerBlock, setWordsPerBlock] = useState(6);
  const [style,         setStyle]         = useState(DEFAULT_STYLE);
  const [highlight,     setHighlight]     = useState("box");
  const [activePanel,   setActivePanel]   = useState("style");
  const [outputName,    setOutputName]    = useState("autocap-output");
  const [quality,       setQuality]       = useState("balanced");

  // Burn state
  const [burnPhase,    setBurnPhase]    = useState("idle"); // idle|loading|rendering|done|error
  const [burnProgress, setBurnProgress] = useState({ stage:"", pct:0, overall:0 });
  const [burnBlob,     setBurnBlob]     = useState(null);
  const [burnError,    setBurnError]    = useState("");
  const cancelBurn = useRef(false);

  const playRef  = useRef(null);
  const duration = captions.length ? captions[captions.length - 1].end + 2 : 30;

  // Keep edit box in sync with selected caption
  useEffect(() => {
    setEditText(captions[selectedIdx]?.text || "");
  }, [selectedIdx, captions]);

  // Playback tick
  useEffect(() => {
    if (playing) {
      playRef.current = setInterval(() => {
        setCurrentTime(t => {
          const next = +(t + 0.1).toFixed(2);
          if (next >= duration) { setPlaying(false); return 0; }
          return next;
        });
      }, 100);
    } else {
      clearInterval(playRef.current);
    }
    return () => clearInterval(playRef.current);
  }, [playing, duration]);

  // Auto-select caption during playback
  useEffect(() => {
    if (!playing) return;
    const idx = captions.findIndex(c => currentTime >= c.start && currentTime < c.end);
    if (idx !== -1 && idx !== selectedIdx) setSelectedIdx(idx);
  }, [currentTime, playing, captions]);

  // Auto-clear load error
  useEffect(() => {
    if (!loadError) return;
    const t = setTimeout(() => setLoadError(""), 7000);
    return () => clearTimeout(t);
  }, [loadError]);

  // ── File upload + transcription ──
  const handleFile = useCallback(async (file) => {
    setVideoFile(file);
    setLoading(true);
    setLoadError("");
    try {
      let mediaToTranscribe = file;
      
      // Prevent Out-Of-Memory (OOM) browser crashes by extracting a small audio track
      // FIRST instead of loading the entire HD video into the AudioContext Decoder.
      // NOTE: This is strictly for the AI to listen to. The final output video retains the original video and audio.
      if (file.type.startsWith("video/")) {
        setLoadStatus("Separating audio track for AI...");
        mediaToTranscribe = await extractAudio(file, (p) => {
          setLoadStatus(p.stage);
        });
      }
      
      setAudioBlob(mediaToTranscribe);
      const words = await transcribeOffline(mediaToTranscribe, setLoadStatus);
      const caps  = groupIntoCaptions(words, wordsPerBlock);
      setCaptions(caps);
      setSelectedIdx(0);
      setCurrentTime(0);
      setPlaying(false);
    } catch (e) {
      setLoadError(e.message);
      setCaptions(DEMO); // fall back to demo so UI isn't empty
    } finally {
      setLoading(false);
      setLoadStatus("");
    }
  }, [wordsPerBlock]);

  // Generate Audio Waveform
  useEffect(() => {
    if (!audioBlob) return;
    const generateWaveform = async () => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const audioBuffer = await audioContext.decodeAudioData(e.target.result);
            const rawData = audioBuffer.getChannelData(0);
            const samples = 150;
            const blockSize = Math.floor(rawData.length / samples);
            const filteredData = [];
            for (let i = 0; i < samples; i++) {
              let blockStart = blockSize * i;
              let sum = 0;
              for (let j = 0; j < blockSize; j++) {
                sum += Math.abs(rawData[blockStart + j]);
              }
              filteredData.push(sum / blockSize);
            }
            const canvas = waveformCanvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.offsetWidth * dpr;
            canvas.height = canvas.offsetHeight * dpr;
            ctx.scale(dpr, dpr);
            
            const width = canvas.offsetWidth;
            const height = canvas.offsetHeight;
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = "#4a4a4a";
            const multiplier = Math.max(...filteredData);
            const barWidth = width / samples;
            
            for (let i = 0; i < samples; i++) {
              const h = (filteredData[i] / multiplier) * height * 0.8;
              ctx.fillRect(i * barWidth, height / 2 - h / 2, barWidth - 1, h || 1);
            }
          } catch (err) {
            console.error(err);
          }
        };
        reader.readAsArrayBuffer(audioBlob);
      } catch (e) {
        console.error(e);
      }
    };
    generateWaveform();
  }, [audioBlob]);

  // ── Caption actions ──
  const selectCaption = (i) => {
    setSelectedIdx(i);
    setCurrentTime(captions[i].start);
    setPlaying(false);
  };

  const saveEdit = () => {
    const text = editText.trim();
    if (!text) return;
    setCaptions(prev => prev.map((c, i) => i === selectedIdx ? { ...c, text } : c));
  };

  const splitCaption = () => {
    const words = editText.trim().split(" ");
    if (words.length < 2) return;
    const mid     = Math.ceil(words.length / 2);
    const midTime = (captions[selectedIdx].start + captions[selectedIdx].end) / 2;
    setCaptions(prev => {
      const next = [...prev];
      next[selectedIdx] = { ...next[selectedIdx], text: words.slice(0, mid).join(" "), end: midTime };
      next.splice(selectedIdx + 1, 0, {
        id: `cap-${Date.now()}`, text: words.slice(mid).join(" "),
        start: midTime, end: captions[selectedIdx].end, words: [],
      });
      return next;
    });
  };

  const deleteCaption = (i) => {
    if (captions.length <= 1) return;
    setCaptions(prev => prev.filter((_, idx) => idx !== i));
    setSelectedIdx(Math.max(0, i - 1));
  };

  const addCaption = () => {
    const last = captions[captions.length - 1];
    const newCap = { id:`cap-${Date.now()}`, text:"New caption",
      start: last?.end || 0, end: (last?.end || 0) + 2, words:[] };
    setCaptions(prev => [...prev, newCap]);
    setSelectedIdx(captions.length);
  };

  const updateStyle = (key, val) => setStyle(s => ({ ...s, [key]: val }));

  // ── Timeline scrub ──
  const scrub = (e) => {
    const bar = e.currentTarget;
    const pct = (e.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth;
    setCurrentTime(+(Math.max(0, Math.min(1, pct)) * duration).toFixed(2));
  };

  // ── Burn to video ──
  const startBurn = async () => {
    if (!videoFile || !captions.length) return;
    cancelBurn.current = false;
    setBurnPhase("loading");
    setBurnError("");
    setBurnBlob(null);

    const onProgress = ({ stage, pct, overall }) => {
      if (cancelBurn.current) return;
      setBurnProgress({ stage: stage || "", pct: pct ?? 0, overall: overall ?? 0 });
      if (stage?.toLowerCase().includes("render")) setBurnPhase("rendering");
      else setBurnPhase(p => p === "rendering" ? p : "loading");
    };

    try {
      const blob = await burnCaptionsToVideo(videoFile, captions, { ...style, quality }, onProgress);
      if (!cancelBurn.current) { setBurnBlob(blob); setBurnPhase("done"); }
    } catch (e) {
      if (!cancelBurn.current) { setBurnError(e.message || "Render failed"); setBurnPhase("error"); }
    }
  };

  const cancelBurnFn = () => {
    cancelBurn.current = true;
    setBurnPhase("idle");
    setBurnProgress({ stage:"", pct:0, overall:0 });
  };

  const resetBurn = () => {
    setBurnPhase("idle"); setBurnBlob(null);
    setBurnError(""); setBurnProgress({ stage:"", pct:0, overall:0 });
  };

  // ── Derived values ──
  const liveCapIdx   = captions.findIndex(c => currentTime >= c.start && currentTime < c.end);
  const displayCap   = playing && liveCapIdx !== -1 ? captions[liveCapIdx] : captions[selectedIdx];
  const pct          = Math.min((currentTime / duration) * 100, 100);
  const burnWorking  = burnPhase === "loading" || burnPhase === "rendering";
  const burnDone     = burnPhase === "done";
  const burnFailed   = burnPhase === "error";
  const previewDims  = videoFormat === "9:16" ? {w:310,h:552} : videoFormat === "16:9" ? {w:560,h:315} : {w:420,h:420};
  const overlayPos   = style.position === "top" ? {top:60} : style.position === "center" ? {top:"50%",transform:"translateY(-50%)"} : {bottom:80};

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh",
      overflow:"hidden", background:"var(--bg)" }}>

      {/* ═══ HEADER ═══ */}
      <header style={{ height:50, background:"var(--s1)", borderBottom:"1px solid var(--b1)",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"0 18px", flexShrink:0 }}>

        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:21,
          letterSpacing:3, color:"#fff" }}>
          AUTO<span style={{ color:"var(--t3)" }}>CAP</span>
        </div>

        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
            color:"var(--t3)", marginRight:4 }}>
            {captions.length} captions · {fmtTime(duration)}
          </span>
          <button className="btn btn-ghost btn-sm"
            onClick={() => downloadText(buildSRT(captions), `${outputName}.srt`)}
            disabled={!captions.length}>⬇ SRT</button>
          <button className="btn btn-ghost btn-sm"
            onClick={() => downloadText(buildVTT(captions), `${outputName}.vtt`)}
            disabled={!captions.length}>⬇ VTT</button>
          <button className="btn btn-grey btn-sm"
            onClick={() => downloadText(buildTXT(captions), `${outputName}.txt`)}
            disabled={!captions.length}>⬇ TXT</button>
          <button className="btn btn-white btn-sm"
            onClick={() => setActivePanel("export")}>
            🎬 Export Video
          </button>
        </div>
      </header>

      {/* ═══ WORKSPACE ═══ */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── LEFT: Captions ── */}
        <div style={{ width:252, background:"var(--s1)", borderRight:"1px solid var(--b1)",
          display:"flex", flexDirection:"column", flexShrink:0 }}>

          {/* Words-per-block selector */}
          <div style={{ padding:"11px 14px 9px", borderBottom:"1px solid var(--b1)",
            display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <Label>Captions</Label>
            <div style={{ display:"flex", gap:4, alignItems:"center" }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"var(--t4)" }}>
                words/block
              </span>
              {[4,6,8].map(n => (
                <button key={n} onClick={() => setWordsPerBlock(n)}
                  style={{ padding:"2px 7px", borderRadius:4,
                    border:"1px solid var(--b2)",
                    background: wordsPerBlock===n ? "var(--grey)" : "transparent",
                    color: wordsPerBlock===n ? "var(--t1)" : "var(--t3)",
                    fontSize:10, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <UploadZone onFile={handleFile} disabled={loading} />

          {/* Transcription status */}
          {loading && (
            <div style={{ padding:"6px 14px", display:"flex",
              alignItems:"center", gap:8, color:"var(--t2)", fontSize:12 }}>
              <div className="spinner" />
              {loadStatus || "Transcribing…"}
            </div>
          )}

          {/* Error */}
          {loadError && (
            <div style={{ margin:"4px 12px", padding:"8px 10px", borderRadius:7,
              background:"#1a0808", border:"1px solid #4a1a1a",
              color:"#cc5555", fontSize:11, lineHeight:1.5 }}>
              ⚠ {loadError}
            </div>
          )}

          {/* Demo + sort buttons */}
          {!loading && (
            <div style={{ padding:"4px 12px 6px", display:"flex", gap:5 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex:1, fontSize:11 }}
                onClick={() => { setCaptions(DEMO); setSelectedIdx(0); setVideoFile(null); }}>
                Load Demo
              </button>
              <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }}
                onClick={() => setCaptions(prev => [...prev].sort((a,b) => a.start - b.start))}>
                Sort
              </button>
              <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }}
                onClick={addCaption}>+ Add</button>
            </div>
          )}

          <div style={{ height:1, background:"var(--b1)" }} />

          {/* Caption list */}
          <div style={{ flex:1, overflowY:"auto", padding:"5px 7px 8px" }}>
            {captions.length === 0 && !loading && (
              <div style={{ padding:"20px 12px", textAlign:"center",
                color:"var(--t3)", fontSize:12, lineHeight:1.7 }}>
                Upload a video or audio file<br/>to generate captions
              </div>
            )}
            {captions.map((c, i) => (
              <div key={c.id}
                className={`cap-item${i === selectedIdx ? " active" : ""}`}
                onClick={() => selectCaption(i)}>

                {/* Live playback indicator */}
                {i === liveCapIdx && (
                  <div className="pulse" style={{ position:"absolute", top:10, right:10,
                    width:5, height:5, borderRadius:"50%", background:"var(--green)" }} />
                )}

                <div style={{ fontFamily:"'JetBrains Mono',monospace",
                  fontSize:9, color:"var(--t3)", marginBottom:3 }}>
                  {fmtTime(c.start)} → {fmtTime(c.end)}
                </div>
                <div style={{ color: i===selectedIdx ? "var(--t1)" : "var(--t2)",
                  fontSize:12, lineHeight:1.4 }}>
                  {c.text.length > 60 ? c.text.slice(0,58) + "…" : c.text}
                </div>

                {/* Delete button — only visible on selected */}
                {i === selectedIdx && (
                  <button onClick={e => { e.stopPropagation(); deleteCaption(i); }}
                    style={{ position:"absolute", top:8, right:8,
                      background:"none", border:"none", color:"var(--t3)",
                      cursor:"pointer", fontSize:11, padding:"2px 4px" }}
                    title="Delete caption">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: Preview + Timeline ── */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", background:"#050505" }}>

          {/* Format / position / status toolbar */}
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px",
            borderBottom:"1px solid var(--b1)", background:"var(--s1)",
            flexWrap:"wrap", flexShrink:0 }}>

            {FORMATS.map(f => (
              <button key={f} className={`fmt-pill${videoFormat===f?" active":""}`}
                onClick={() => setVideoFormat(f)}>{f}</button>
            ))}

            <div style={{ width:1, height:20, background:"var(--b2)", margin:"0 2px" }} />

            {POSITIONS.map(p => (
              <button key={p} className={`fmt-pill${style.position===p?" active":""}`}
                onClick={() => updateStyle("position", p)}
                style={{ textTransform:"capitalize" }}>{p}</button>
            ))}

            <div style={{ flex:1 }} />

            {/* Secure Backend status */}
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9 }}>
              <span style={{ color:"var(--green)" }}>● 100% OFFLINE AI ACTIVE</span>
            </span>
          </div>

          {/* Video preview canvas */}
          <div style={{ flex:1, display:"flex", alignItems:"center",
            justifyContent:"center", padding:24, overflow:"hidden" }}>
            <div style={{
              width:  previewDims.w,
              height: previewDims.h,
              background: "#0d0d0d",
              borderRadius: 12,
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 0 0 1px var(--b2), 0 24px 80px rgba(0,0,0,.85)",
              flexShrink: 0,
              transition: "width .3s, height .3s",
            }}>
              {/* Background gradient */}
              <div style={{ position:"absolute", inset:0,
                background:"linear-gradient(155deg,#141428 0%,#1a1a3a 50%,#0d2040 100%)",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ color:"var(--t4)", fontSize:12, textAlign:"center", lineHeight:1.6 }}>
                  <div style={{ width:44, height:44, border:"1.5px solid var(--b3)",
                    borderRadius:"50%", display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:16, margin:"0 auto 8px", color:"var(--t3)" }}>▶</div>
                  {videoFile ? videoFile.name.slice(0, 28) : "Upload video to preview"}
                </div>
              </div>

              {/* Caption overlay */}
              <div style={{
                position:"absolute", left:0, right:0, zIndex:10,
                padding:  style.bg ? "8px 16px" : 0,
                background: style.bg ? `rgba(0,0,0,${style.bgOpacity/100})` : "transparent",
                borderRadius: style.bg ? 8 : 0,
                margin: style.bg ? "0 14px" : 0,
                ...overlayPos,
              }}>
                <CaptionDisplay caption={displayCap} style={style} highlight={highlight} />
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div style={{ height:80, background:"var(--s1)", borderTop:"1px solid var(--b1)",
            padding:"0 16px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>

            <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:160 }}>
              <button className="btn btn-ghost btn-icon" style={{ padding:"5px 9px", fontSize:14 }}
                onClick={() => setPlaying(p => !p)}>
                {playing ? "⏸" : "▶"}
              </button>
              <button className="btn btn-ghost btn-icon" style={{ padding:"5px 9px", fontSize:12 }}
                onClick={() => { setCurrentTime(0); setPlaying(false); }}>
                ⏮
              </button>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11,
                color:"var(--t2)", minWidth:70 }}>
                {fmtTime(currentTime)} / {fmtTime(duration)}
              </span>
            </div>
            
            {/* Scrubber wrapper */}
            <div style={{ flex:1, display:"flex", flexDirection:"column", gap:2 }}>
              <div style={{ height:34, background:"var(--s3)", borderRadius:4,
                cursor:"pointer", position:"relative", overflow:"hidden" }} onClick={scrub}>
                
                {/* Waveform Canvas */}
                <canvas ref={waveformCanvasRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />
                
                {/* Progress Overlay */}
                <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${pct}%`, background: "rgba(255, 255, 255, 0.15)", pointerEvents: "none" }} />
                
                {/* Playhead */}
                <div style={{ position:"absolute", top:0, left:`${pct}%`,
                  transform:"translateX(-50%)", width:2, height:"100%",
                  background:"var(--white)", pointerEvents:"none", boxShadow:"0 0 6px rgba(0,0,0,0.5)" }} />
              </div>
              
              {/* Caption markers */}
              <div style={{ display:"flex", gap:2, height:10 }}>
                {captions.map((c, i) => (
                  <div key={c.id}
                    className={`timeline-marker${i===selectedIdx?" active":""}`}
                    style={{ flexGrow:(c.end-c.start)/duration*60, height:10 }}
                    onClick={() => selectCaption(i)} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Style / Export ── */}
        <div style={{ width:276, background:"var(--s1)", borderLeft:"1px solid var(--b1)",
          display:"flex", flexDirection:"column", flexShrink:0 }}>

          {/* Panel tab bar */}
          <div style={{ display:"flex", borderBottom:"1px solid var(--b1)", flexShrink:0 }}>
            {[["style","Style"],["export","Export"]].map(([id,label]) => (
              <button key={id} onClick={() => setActivePanel(id)} style={{
                flex:1, padding:"11px 0", background:"none", border:"none",
                borderBottom:`2px solid ${activePanel===id ? "var(--t1)" : "transparent"}`,
                color: activePanel===id ? "var(--t1)" : "var(--t3)",
                fontFamily:"'JetBrains Mono',monospace", fontSize:10,
                letterSpacing:1.5, textTransform:"uppercase",
                cursor:"pointer", transition:"color .15s",
              }}>{label}</button>
            ))}
          </div>

          <div style={{ flex:1, overflowY:"auto" }}>

            {/* ══ STYLE PANEL ══ */}
            {activePanel === "style" && (<>

              {/* Edit caption text */}
              <div className="panel-section">
                <Label>Edit Caption</Label>
                <textarea className="ac-textarea ac-input" value={editText}
                  onChange={e => setEditText(e.target.value)}
                  placeholder="Select a caption to edit…" />
                <div style={{ display:"flex", gap:5, marginTop:7 }}>
                  <button className="btn btn-grey btn-sm" style={{ flex:1 }} onClick={saveEdit}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={splitCaption}>Split</button>
                </div>
              </div>

              {/* Typography */}
              <div className="panel-section">
                <Label>Typography</Label>
                <Row label="Font">
                  <select className="ac-select" style={{ width:140 }}
                    value={style.font} onChange={e => updateStyle("font", e.target.value)}>
                    {FONTS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Row>
                <Row label="Size">
                  <Slider min={12} max={56} value={style.fontSize} unit="px"
                    onChange={v => updateStyle("fontSize", v)} />
                </Row>
                <Row label="Weight">
                  <select className="ac-select" style={{ width:140 }}
                    value={style.fontWeight} onChange={e => updateStyle("fontWeight", +e.target.value)}>
                    {[[400,"Regular"],[500,"Medium"],[600,"Semi-Bold"],[700,"Bold"],[900,"Black"]]
                      .map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Row>
                <Row label="Spacing">
                  <Slider min={-2} max={8} step={0.5} value={style.letterSpacing} unit="px"
                    onChange={v => updateStyle("letterSpacing", v)} />
                </Row>
              </div>

              {/* Color */}
              <div className="panel-section">
                <Label>Color</Label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
                  {COLORS.map(c => (
                    <div key={c} className={`color-swatch${style.color===c?" active":""}`}
                      style={{ background:c }} onClick={() => updateStyle("color", c)} />
                  ))}
                </div>
                <Row label="Custom">
                  <input type="color" value={style.color}
                    onChange={e => updateStyle("color", e.target.value)}
                    style={{ background:"var(--s3)", border:"1px solid var(--b2)",
                      borderRadius:6, height:30, width:76, cursor:"pointer", padding:"2px 4px" }} />
                </Row>
              </div>

              {/* Animation */}
              <div className="panel-section">
                <Label>Animation</Label>
                <div className="grid-3">
                  {ANIMATIONS.map(a => (
                    <div key={a.id} className={`option-btn${style.animation===a.id?" selected":""}`}
                      onClick={() => updateStyle("animation", a.id)}>
                      <div style={{ fontSize:14, marginBottom:2 }}>{a.icon}</div>
                      <div style={{ fontSize:10 }}>{a.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Highlight */}
              <div className="panel-section">
                <Label>Word Highlight</Label>
                <div className="grid-3">
                  {HIGHLIGHTS.map(h => (
                    <div key={h.id} className={`option-btn${highlight===h.id?" selected":""}`}
                      onClick={() => setHighlight(h.id)} style={{ fontSize:11 }}>
                      {h.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Stroke */}
              <div className="panel-section">
                <Label>Text Stroke</Label>
                <Row label="Enable">
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <Toggle on={style.stroke} onToggle={() => updateStyle("stroke", !style.stroke)} />
                    <span style={{ fontSize:11, color:"var(--t2)" }}>{style.stroke?"On":"Off"}</span>
                  </div>
                </Row>
                <Row label="Width">
                  <Slider min={0} max={8} step={0.5} value={style.strokeWidth} unit="px"
                    onChange={v => updateStyle("strokeWidth", v)} />
                </Row>
                <Row label="Color">
                  <input type="color" value={style.strokeColor || "#000000"}
                    onChange={e => updateStyle("strokeColor", e.target.value)}
                    style={{ background:"var(--s3)", border:"1px solid var(--b2)",
                      borderRadius:6, height:28, width:60, cursor:"pointer", padding:"2px 3px" }} />
                </Row>
              </div>

              {/* Effects */}
              <div className="panel-section">
                <Label>Effects</Label>
                <Row label="Drop Shadow">
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <Toggle on={style.shadow} onToggle={() => updateStyle("shadow", !style.shadow)} />
                    <span style={{ fontSize:11, color:"var(--t2)" }}>{style.shadow?"On":"Off"}</span>
                  </div>
                </Row>
                <Row label="Caption BG">
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <Toggle on={style.bg} onToggle={() => updateStyle("bg", !style.bg)} />
                    <span style={{ fontSize:11, color:"var(--t2)" }}>{style.bg?"On":"Off"}</span>
                  </div>
                </Row>
                {style.bg && (
                  <Row label="BG Opacity">
                    <Slider min={0} max={100} value={style.bgOpacity} unit="%"
                      onChange={v => updateStyle("bgOpacity", v)} />
                  </Row>
                )}
              </div>
            </>)}

            {/* ══ EXPORT PANEL ══ */}
            {activePanel === "export" && (<>

              {/* Subtitle downloads — always available */}
              <div className="panel-section">
                <Label>Subtitle Files</Label>
                <div style={{ display:"flex", gap:5 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex:1 }}
                    onClick={() => downloadText(buildSRT(captions), `${outputName}.srt`)}
                    disabled={!captions.length}>⬇ SRT</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex:1 }}
                    onClick={() => downloadText(buildVTT(captions), `${outputName}.vtt`)}
                    disabled={!captions.length}>⬇ VTT</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex:1 }}
                    onClick={() => downloadText(buildTXT(captions), `${outputName}.txt`)}
                    disabled={!captions.length}>⬇ TXT</button>
                </div>
              </div>

              {/* Output filename */}
              <div className="panel-section">
                <Label>Output Filename</Label>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <input className="ac-input" style={{ flex:1 }} value={outputName}
                    onChange={e => setOutputName(e.target.value.replace(/[^a-zA-Z0-9_-]/g,""))}
                    placeholder="autocap-output" />
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"var(--t3)" }}>.mp4</span>
                </div>
              </div>

              {/* Quality preset */}
              <div className="panel-section">
                <Label>Render Quality</Label>
                <div style={{ display:"flex", gap:5 }}>
                  {QUALITY.map(q => (
                    <button key={q.id} onClick={() => !burnWorking && setQuality(q.id)}
                      style={{ flex:1, padding:"8px 4px", borderRadius:7, cursor:"pointer",
                        border:`1px solid ${quality===q.id?"var(--b3)":"var(--b2)"}`,
                        background: quality===q.id ? "var(--s4)" : "var(--s2)",
                        color: quality===q.id ? "var(--t1)" : "var(--t3)",
                        fontFamily:"'DM Sans',sans-serif", fontSize:11,
                        transition:"all .15s", textAlign:"center" }}>
                      <div style={{ fontWeight:700, marginBottom:1 }}>{q.label}</div>
                      <div style={{ fontSize:9, color:quality===q.id?"var(--t3)":"var(--t4)" }}>
                        CRF {q.crf}
                      </div>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop:5, fontFamily:"'JetBrains Mono',monospace",
                  fontSize:9, color:"var(--t4)" }}>
                  {QUALITY.find(q=>q.id===quality)?.note}
                </div>
              </div>

              {/* Source info */}
              {videoFile && (
                <div className="panel-section">
                  <Label>Source File</Label>
                  <div style={{ background:"var(--s2)", border:"1px solid var(--b1)",
                    borderRadius:8, padding:"9px 11px" }}>
                    {[
                      ["File", videoFile.name.length>28 ? videoFile.name.slice(0,26)+"…" : videoFile.name],
                      ["Size", `${(videoFile.size/1024/1024).toFixed(1)} MB`],
                      ["Captions", `${captions.length} blocks`],
                    ].map(([k,v]) => (
                      <div key={k} style={{ display:"flex", justifyContent:"space-between",
                        marginBottom:4, fontSize:12 }}>
                        <span style={{ color:"var(--t3)" }}>{k}</span>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace",
                          fontSize:10, color:"var(--t2)" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              <div style={{ padding:"0 14px" }}>
                {!videoFile && (
                  <div className="notice notice-warn" style={{ margin:"8px 0" }}>
                    ⚠ Upload a video first to enable burn-in
                  </div>
                )}
                {videoFile && !captions.length && (
                  <div className="notice notice-warn" style={{ margin:"8px 0" }}>
                    ⚠ No captions yet — upload and transcribe first
                  </div>
                )}
              </div>

              {/* Burn button + states */}
              <div style={{ padding:"8px 14px 18px" }}>

                {/* IDLE / WORKING */}
                {!burnDone && !burnFailed && (<>
                  <button className="btn btn-white btn-full"
                    disabled={!videoFile || !captions.length || burnWorking}
                    onClick={startBurn}>
                    {burnWorking
                      ? <><div className="spinner" style={{ borderTopColor:"#000" }} /> Rendering…</>
                      : "🎬 Burn Captions to Video"}
                  </button>

                  {burnWorking && (
                    <div style={{ background:"var(--s2)", border:"1px solid var(--b1)",
                      borderRadius:9, padding:14, marginTop:10 }}>

                      <div style={{ display:"flex", justifyContent:"space-between",
                        marginBottom:5, fontSize:12 }}>
                        <span style={{ color:"var(--t2)" }}>Overall</span>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace",
                          fontSize:10, color:"var(--t2)" }}>{burnProgress.overall}%</span>
                      </div>
                      <ProgressBar pct={burnProgress.overall} color="var(--white)" />

                      <div style={{ height:8 }} />

                      <div style={{ display:"flex", justifyContent:"space-between",
                        marginBottom:5, fontSize:11 }}>
                        <span style={{ color:"var(--t3)" }}>{burnProgress.stage || "Working…"}</span>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace",
                          fontSize:10, color:"var(--t3)" }}>{burnProgress.pct}%</span>
                      </div>
                      <ProgressBar pct={burnProgress.pct} color="var(--grey-a)" />

                      <div style={{ marginTop:10, display:"flex", justifyContent:"center" }}>
                        <button className="btn btn-ghost btn-sm" onClick={cancelBurnFn}>
                          Cancel
                        </button>
                      </div>

                      <div className="notice notice-info" style={{ marginTop:10, fontSize:10 }}>
                        ⏱ FFmpeg is running in your browser.<br/>
                        Do not close this tab. Large files take longer.
                      </div>
                    </div>
                  )}
                </>)}

                {/* DONE */}
                {burnDone && (
                  <div>
                    <div className="notice notice-ok" style={{ marginBottom:10 }}>
                      <div style={{ fontWeight:700, marginBottom:3 }}>✓ Render complete</div>
                      <div style={{ fontSize:11 }}>H.264 / MP4 — saved to your Downloads</div>
                    </div>
                    <button className="btn btn-white btn-full" style={{ marginBottom:7 }}
                      onClick={() => downloadBlob(burnBlob, `${outputName}.mp4`)}>
                      ⬇ Download {outputName}.mp4
                    </button>
                    <button className="btn btn-ghost btn-full" onClick={resetBurn}>
                      Render Again
                    </button>
                  </div>
                )}

                {/* ERROR */}
                {burnFailed && (
                  <div>
                    <div className="notice notice-error" style={{ marginBottom:10 }}>
                      <div style={{ fontWeight:700, marginBottom:3 }}>✕ Render failed</div>
                      <div style={{ fontSize:11 }}>{burnError}</div>
                    </div>
                    <div className="notice notice-info" style={{ marginBottom:12, fontSize:11, lineHeight:1.7 }}>
                      <strong style={{ color:"var(--t2)" }}>Common fixes:</strong><br/>
                      1. Check vite.config.js has the COOP/COEP headers<br/>
                      2. File is too large for your browser RAM — try a shorter clip<br/>
                      3. Open browser console (F12) for the full error
                    </div>
                    <button className="btn btn-grey btn-full" onClick={resetBurn}>Try Again</button>
                  </div>
                )}
              </div>
            </>)}
          </div>
        </div>
      </div>

      {/* ═══ STATUS BAR ═══ */}
      <div style={{ height:24, background:"var(--s1)", borderTop:"1px solid var(--b1)",
        display:"flex", alignItems:"center", padding:"0 16px", gap:18, flexShrink:0 }}>
        {[
          { dot:captions.length ? "var(--green)" : "var(--t4)", text: captions.length ? "Ready" : "No captions" },
          { text:`Captions: ${captions.length}` },
          { text:`Duration: ${fmtTime(duration)}` },
          { text:"Transcription: Gemini 2.0 Flash (free)" },
          { text:"Burn: FFmpeg.wasm (browser, free)" },
        ].map((item, i) => (
          <div key={i} style={{ fontFamily:"'JetBrains Mono',monospace",
            fontSize:9, color:"var(--t4)", display:"flex", alignItems:"center", gap:4 }}>
            {item.dot && <span style={{ color:item.dot, fontSize:7 }}>●</span>}
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}
