/**
 * state.ts — Estado mutable compartido + utilidades de DOM.
 *
 * Como los módulos ES no pueden reasignar los `let` importados de otro módulo,
 * todo el estado mutable que se comparte entre módulos vive como propiedades de
 * `app` (un único objeto singleton). Así hay una sola fuente de verdad.
 */
import type {
  Config,
  Mode,
  RoomState,
  User,
  WebSocketLike,
} from "./protocol";

/** Frecuencia de muestreo destino que espera el backend (PCM 16-bit). */
export const TARGET_RATE = 24000;

/* Parámetros del gate VAD (detección de voz) */
export const VAD_POS = 0.35; // isSpeech > → abre el gate de inmediato
export const VAD_NEG = 0.2; // isSpeech < → cuenta como frame de silencio
export const VAD_SILENT_OFF = 40; // ~1.3 s de silencio continuo antes de cerrar

export interface AppState {
  demo: boolean;
  ws: WebSocketLike | null;
  recording: boolean;
  backendReady: boolean;
  mode: Mode;
  currentView: string;
  roomState: RoomState | null;
  currentUser: User | null;
  currentRecordingId: string | null;
  // Audio
  micStream: MediaStream | null;
  audioCtx: AudioContext | null;
  mic: MediaStreamAudioSourceNode | null;
  audioProcessor: ScriptProcessorNode | null;
  // VAD
  vadInstance: any;
  vadGate: boolean;
  vadSilentCount: number;
}

export const app: AppState = {
  demo: false,
  ws: null,
  recording: false,
  backendReady: false,
  mode: "idle",
  currentView: "landing",
  roomState: null,
  currentUser: null,
  currentRecordingId: null,
  micStream: null,
  audioCtx: null,
  mic: null,
  audioProcessor: null,
  vadInstance: null,
  vadGate: true,
  vadSilentCount: 0,
};

export const config: Config = {
  lang: "auto",
  target: "ru",
  translate: true,
  tts: false,
  voice: "Cherry",
  engine: "openai",
};

/* ---------------- utilidades de DOM ---------------- */

/** getElementById tipado. Asume que el elemento existe (markup estático). */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

/** Variante segura: devuelve null si no existe. */
export function $opt<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function escapeHtml(s: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}

export function hideEmpty(containerId: string): void {
  const c = $opt(containerId);
  const e = c?.querySelector<HTMLElement>(".empty-state");
  if (e) e.style.display = "none";
}

export function scrollDown(id: string): void {
  const e = $opt(id);
  if (e) e.scrollTop = e.scrollHeight;
}
