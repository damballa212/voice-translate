/**
 * audio.ts — Captura de micrófono, reenvío de PCM al servidor, gate VAD,
 * visualización de onda (AnalyserNode FFT) y reproducción de audio TTS.
 */
import {
  $opt,
  app,
  config,
  TARGET_RATE,
  VAD_NEG,
  VAD_POS,
  VAD_SILENT_OFF,
} from "./state";
import { send } from "./ws";
import { hideBusyBanner, setMicTitle, showBusyBanner, toast } from "./ui";
import { resetSoloBubbles } from "./solo";
import { demoToggleMic } from "./demo";

export async function toggleMic(): Promise<void> {
  if (app.demo) {
    demoToggleMic();
    return;
  }
  const b =
    app.mode === "room" ? $opt("micRoom") : $opt("micSolo");
  const uiRecording = b?.classList.contains("recording");
  if (app.recording || uiRecording) {
    stopMic();
    return;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext!;
    app.audioCtx = new Ctx();
    const actualRate = app.audioCtx.sampleRate;
    app.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    let waited = 0;
    while (!app.ws || app.ws.readyState !== WebSocket.OPEN) {
      if (waited++ > 10) throw new Error("WS connection timeout");
      await new Promise((r) => setTimeout(r, 500));
    }

    if (app.mode === "solo") {
      send({ command: "start", ...config });
      resetSoloBubbles();
    } else if (app.mode === "room") {
      send({ command: "speak_start" });
    }

    app.mic = app.audioCtx.createMediaStreamSource(app.micStream);
    app.audioProcessor = app.audioCtx.createScriptProcessor(4096, 1, 1);
    app.mic.connect(app.audioProcessor);
    app.audioProcessor.connect(app.audioCtx.destination);
    app.audioProcessor.onaudioprocess = (e) => {
      if (!app.recording || !app.backendReady) return;
      if (app.vadInstance && !app.vadGate) return; // VAD: no es voz → omitir
      const inp = e.inputBuffer.getChannelData(0);
      let s = inp;
      if (actualRate !== TARGET_RATE && actualRate > 0) {
        const ratio = actualRate / TARGET_RATE;
        const ol = Math.floor(inp.length / ratio);
        s = new Float32Array(ol);
        for (let i = 0; i < ol; i++) {
          const si = i * ratio;
          const fl = Math.floor(si);
          const fr = si - fl;
          const a = inp[fl] || 0;
          const b2 = inp[fl + 1] || a;
          s[i] = a + (b2 - a) * fr;
        }
      }
      const pcm = new Int16Array(s.length);
      for (let i = 0; i < s.length; i++)
        pcm[i] = Math.max(-32768, Math.min(32767, s[i] * 32768));
      const bytes = new Uint8Array(pcm.buffer);
      const chunks: string[] = [];
      const C = 4096;
      for (let i = 0; i < bytes.length; i += C)
        chunks.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + C))));
      send({ command: "audio", data: btoa(chunks.join("")) });
    };

    app.recording = true;
    app.backendReady = false;
    b?.classList.add("connecting");
    if (b) playMicBurst(b);
    setMicTitle("⏳ Conectando...", true);
    showBusyBanner("Conectando al servidor...");
    startVAD();
  } catch (err) {
    console.error("[mic] error", err);
    cleanupMic();
    toast((err as Error).message || "Micrófono no disponible");
  }
}

export function stopMic(label = "Detenido"): void {
  cleanupMic();
  document.querySelectorAll<HTMLElement>(".mic").forEach((b) => {
    b.classList.remove("recording", "connecting");
  });
  hideBusyBanner();
  setMicTitle(label);
  if (app.mode === "solo") send({ command: "stop" });
  else if (app.mode === "room") send({ command: "speak_stop" });
}

function cleanupMic(): void {
  app.recording = false;
  app.backendReady = false;
  stopWaveViz();
  if (app.audioProcessor) {
    try {
      app.audioProcessor.disconnect();
    } catch {}
    app.audioProcessor = null;
  }
  if (app.mic) {
    try {
      app.mic.disconnect();
    } catch {}
    app.mic = null;
  }
  if (app.micStream) {
    app.micStream.getTracks().forEach((t) => t.stop());
    app.micStream = null;
  }
  if (app.audioCtx) {
    try {
      app.audioCtx.close();
    } catch {}
    app.audioCtx = null;
  }
  stopVAD();
}

/* ---------------- VAD (detección de voz) ---------------- */
async function startVAD(): Promise<void> {
  if (app.vadInstance) return;
  if (!window.vad || !window.vad.MicVAD) {
    console.warn("[vad] library not loaded — passthrough");
    toast("⚠ VAD no cargado — sigue usable");
    app.vadInstance = null;
    app.vadGate = true;
    return;
  }
  try {
    app.vadGate = true;
    app.vadSilentCount = 0;
    toast("⏳ Cargando VAD...");
    const inst = await window.vad.MicVAD.new({
      baseAssetPath:
        "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/",
      onnxWASMBasePath:
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
      onFrameProcessed: (probs) => {
        if (probs.isSpeech > VAD_POS) {
          app.vadGate = true;
          app.vadSilentCount = 0;
        } else if (probs.isSpeech < VAD_NEG) {
          app.vadSilentCount++;
          if (app.vadSilentCount > VAD_SILENT_OFF) app.vadGate = false;
        }
      },
    });
    await inst.start();
    app.vadInstance = inst;
    toast("✓ VAD listo");
  } catch (e) {
    console.error("[vad] init failed — passthrough", e);
    toast("⚠ VAD falló — sigue usable");
    app.vadInstance = null;
    app.vadGate = true;
  }
}

async function stopVAD(): Promise<void> {
  const inst = app.vadInstance;
  app.vadInstance = null;
  app.vadGate = true;
  app.vadSilentCount = 0;
  if (inst) {
    try {
      await inst.pause();
    } catch {}
    try {
      inst.destroy && inst.destroy();
    } catch {}
  }
}

/* ---------------- Burst de arranque del micrófono ---------------- */
export function playMicBurst(btn: HTMLElement): void {
  if (!btn) return;
  btn.classList.remove("just-started");
  btn.querySelector(".mic-burst-ring")?.remove();
  void btn.offsetWidth;
  btn.classList.add("just-started");
  const ring = document.createElement("div");
  ring.className = "mic-burst-ring";
  btn.appendChild(ring);
  setTimeout(() => {
    btn.classList.remove("just-started");
    ring.remove();
  }, 620);
}

/** Servidor listo: connecting → recording. */
export function onBackendReady(engLabel?: string): void {
  app.backendReady = true;
  document.querySelectorAll<HTMLElement>(".mic.connecting").forEach((b) => {
    b.classList.remove("connecting");
    b.classList.add("recording");
  });
  hideBusyBanner();
  setMicTitle(`${engLabel || ""} · Grabando`.trim(), false);
  startWaveViz();
}

/* ---------------- Onda real (AnalyserNode FFT) ---------------- */
const WAVE_BARS = 24;
let _audioAnalyser: AnalyserNode | null = null;
let _vizRafId: number | null = null;

function ensureWaveBars(containerId: string): HTMLElement | null {
  const el = $opt(containerId);
  if (!el) return null;
  if (el.children.length !== WAVE_BARS) {
    el.innerHTML = "";
    for (let i = 0; i < WAVE_BARS; i++) {
      const b = document.createElement("div");
      b.className = "wave-bar";
      el.appendChild(b);
    }
  }
  return el;
}

function startWaveViz(): void {
  if (!app.audioCtx || !app.mic) return;
  if (_audioAnalyser) return;
  const containerId = app.mode === "room" ? "waveRoom" : "waveSolo";
  const el = ensureWaveBars(containerId);
  if (!el) return;
  el.classList.add("live");
  try {
    _audioAnalyser = app.audioCtx.createAnalyser();
    _audioAnalyser.fftSize = 64;
    _audioAnalyser.smoothingTimeConstant = 0.72;
    app.mic.connect(_audioAnalyser);
  } catch (e) {
    console.error("[wave-viz] analyser init failed", e);
    el.classList.remove("live");
    return;
  }
  const buf = new Uint8Array(_audioAnalyser.frequencyBinCount);
  const bars = el.querySelectorAll<HTMLElement>(".wave-bar");
  const tick = () => {
    if (!_audioAnalyser) return;
    _audioAnalyser.getByteFrequencyData(buf);
    for (let i = 0; i < bars.length; i++) {
      const v = (buf[i] || 0) / 255;
      const s = 0.06 + v * 0.94;
      bars[i].style.transform = `scaleY(${s})`;
    }
    _vizRafId = requestAnimationFrame(tick);
  };
  tick();
}

function stopWaveViz(): void {
  if (_vizRafId) cancelAnimationFrame(_vizRafId);
  _vizRafId = null;
  if (_audioAnalyser) {
    try {
      _audioAnalyser.disconnect();
    } catch {}
  }
  _audioAnalyser = null;
  document.querySelectorAll<HTMLElement>(".wave-viz").forEach((el) => {
    el.classList.remove("live");
    el.querySelectorAll<HTMLElement>(".wave-bar").forEach((b) => {
      b.style.transform = "scaleY(0.06)";
    });
  });
}

/* ---------------- Reproducción de audio (TTS PCM) ---------------- */
export function playAudio(b64: string, sr: number): void {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const Ctx = window.AudioContext || window.webkitAudioContext!;
    let ctx: AudioContext;
    try {
      ctx = new Ctx({ sampleRate: sr });
    } catch {
      ctx = new Ctx();
    }
    const ar = ctx.sampleRate;
    let s: Float32Array | number[] = Array.from(pcm).map((v) => v / 32768);
    if (ar !== sr) {
      const ratio = sr / ar;
      const nl = Math.round(pcm.length * ratio);
      const r = new Float32Array(nl);
      for (let i = 0; i < nl; i++) {
        const si = i / ratio;
        const fl = Math.floor(si);
        const fr = si - fl;
        const a = (s as number[])[fl] || 0;
        const b = (s as number[])[fl + 1] || a;
        r[i] = a + (b - a) * fr;
      }
      s = r;
    }
    const arr = s instanceof Float32Array ? s : Float32Array.from(s);
    const buf = ctx.createBuffer(1, arr.length, ar);
    buf.getChannelData(0).set(arr);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  } catch (e) {
    console.error("playAudio", e);
  }
}
