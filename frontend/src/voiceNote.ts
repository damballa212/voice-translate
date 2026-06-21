/**
 * voiceNote.ts — Hold-to-record voice notes for DM (WhatsApp style).
 */
import type { DmMessage } from "./protocol";
import { $opt } from "./state";
import { toast } from "./ui";
import { t } from "./i18n";

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let activeConversationId = 0;
let onSentCb: ((message: DmMessage) => void) | null = null;
let durationInterval: ReturnType<typeof setInterval> | null = null;
let cancelled = false;
let startX = 0;

function setButtonRecording(on: boolean): void {
  const btn = $opt("chatActionBtn");
  btn?.classList.toggle("recording", on);
}

function showRecordingUI(on: boolean): void {
  const bar = $opt("chatRecordBar");
  bar?.classList.toggle("active", on);
  const composer = $opt("chatComposerInner");
  composer?.classList.toggle("hidden", on);
}

function updateDuration(): void {
  const el = $opt("chatRecordDuration");
  if (!el) return;
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = `${m}:${String(s).padStart(2, "0")}`;
}

export async function startRecording(
  conversationId: number,
  onSent: (message: DmMessage) => void,
): Promise<void> {
  if (recorder && recorder.state === "recording") return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    toast(t("dm-voice-unsupported"));
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    chunks = [];
    activeConversationId = conversationId;
    onSentCb = onSent;
    startedAt = Date.now();
    cancelled = false;
    recorder = new MediaRecorder(stream, { mimeType: preferred });
    recorder.ondataavailable = (ev) => {
      if (ev.data.size) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setButtonRecording(false);
      showRecordingUI(false);
      if (durationInterval) { clearInterval(durationInterval); durationInterval = null; }
      if (cancelled) {
        chunks = [];
        cancelled = false;
        return;
      }
      uploadVoiceNote().catch(() => toast(t("dm-voice-upload-error")));
    };
    recorder.start();
    setButtonRecording(true);
    showRecordingUI(true);
    updateDuration();
    durationInterval = setInterval(updateDuration, 500);
    startX = 0;
    const btn = $opt("chatActionBtn");
    if (btn) {
      const onMove = (e: TouchEvent) => {
        const x = e.touches[0].clientX;
        if (!startX) startX = x;
        const dx = x - startX;
        if (dx < -80) {
          btn.removeEventListener("touchmove", onMove);
          cancelRecording();
        }
      };
      btn.addEventListener("touchmove", onMove, { passive: true });
      const cleanup = () => btn.removeEventListener("touchmove", onMove);
      btn.addEventListener("touchend", cleanup, { once: true });
      btn.addEventListener("touchcancel", cleanup, { once: true });
    }
  } catch {
    setButtonRecording(false);
    showRecordingUI(false);
    toast(t("toast-mic-unavailable"));
  }
}

export function stopRecording(): void {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }
}

export function cancelRecording(): void {
  if (recorder && recorder.state === "recording") {
    cancelled = true;
    recorder.stop();
    toast(t("dm-voice-cancelled") || "Grabación cancelada");
  }
}

export function toggleVoiceNote(
  conversationId: number,
  onSent: (message: DmMessage) => void,
): void {
  if (recorder && recorder.state === "recording") {
    stopRecording();
  } else {
    startRecording(conversationId, onSent);
  }
}

async function uploadVoiceNote(): Promise<void> {
  const duration = Date.now() - startedAt;
  const mime = chunks[0]?.type?.split(";")[0] || "audio/webm";
  const blob = new Blob(chunks, { type: mime });
  recorder = null;
  chunks = [];
  if (!blob.size || !activeConversationId) return;
  if (duration < 500) return;
  const r = await fetch(`/dm/conversations/${activeConversationId}/voice`, {
    method: "POST",
    headers: {
      "Content-Type": mime,
      "X-Voice-Duration-Ms": String(duration),
    },
    body: blob,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.detail || "upload failed");
  }
  const message = await r.json();
  onSentCb?.(message);
  onSentCb = null;
}
