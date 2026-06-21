/**
 * voiceNote.ts — Grabacion de notas de voz para DM.
 *
 * Separado de audio.ts: no inicia sesiones OpenAI ni envia PCM al traductor.
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

function setButtonRecording(on: boolean): void {
  const btn = $opt("chatVoiceBtn");
  btn?.classList.toggle("recording", on);
  if (btn) btn.textContent = on ? "■" : "🎙";
}

export async function toggleVoiceNote(
  conversationId: number,
  onSent: (message: DmMessage) => void,
): Promise<void> {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
    return;
  }
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
    recorder = new MediaRecorder(stream, { mimeType: preferred });
    recorder.ondataavailable = (ev) => {
      if (ev.data.size) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setButtonRecording(false);
      uploadVoiceNote().catch(() => toast(t("dm-voice-upload-error")));
    };
    recorder.start();
    setButtonRecording(true);
    toast(t("dm-voice-recording"));
  } catch {
    setButtonRecording(false);
    toast(t("toast-mic-unavailable"));
  }
}

async function uploadVoiceNote(): Promise<void> {
  const duration = Date.now() - startedAt;
  const mime = chunks[0]?.type?.split(";")[0] || "audio/webm";
  const blob = new Blob(chunks, { type: mime });
  recorder = null;
  chunks = [];
  if (!blob.size || !activeConversationId) return;
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
