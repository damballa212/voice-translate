/**
 * ws.ts — Conexión WebSocket y enrutado de mensajes del servidor.
 *
 * El contrato con el backend se mantiene intacto: se conecta a `/ws`, envía
 * comandos `{ command: ... }` y recibe mensajes `{ type: ... }`.
 */
import { app } from "./state";
import type { ClientCommand, ServerMessage } from "./protocol";
import { setupDemoWs } from "./demo";
import {
  handleSoloTranscript,
  handleSoloTranslation,
} from "./solo";
import {
  onRoomJoined,
  onMemberJoined,
  onMemberLeft,
  onRoomMessage,
  onRoomTranslation,
  onSpeakingState,
} from "./room";
import { onBackendReady, playAudio, stopMic } from "./audio";
import { setMicTitle, showTrialModal, toast } from "./ui";
import { backToLanding } from "./nav";

export function connectWs(): void {
  if (app.demo) {
    setupDemoWs();
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  app.ws = ws;
  ws.onopen = () => console.log("[ws] open");
  ws.onclose = () => {
    console.log("[ws] close, reconnect in 2s");
    if (app.recording) stopMic("Conexión perdida");
    setTimeout(connectWs, 2000);
  };
  ws.onerror = (e) => console.error("[ws] error", e);
  ws.onmessage = (e) => {
    try {
      handleMessage(JSON.parse(e.data) as ServerMessage);
    } catch (err) {
      console.error("[ws] parse", err);
    }
  };
}

export function send(obj: ClientCommand): void {
  const ws = app.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

export function handleMessage(m: ServerMessage): void {
  switch (m.type) {
    case "welcome":
      if (m.recording_id) app.currentRecordingId = m.recording_id;
      break;
    case "ready":
      onBackendReady("⚡ OpenAI");
      if (m.recording_id) app.currentRecordingId = m.recording_id;
      break;
    case "transcript":
      handleSoloTranscript(m);
      break;
    case "translation":
      handleSoloTranslation(m);
      break;
    case "audio":
      playAudio(m.data, m.sample_rate);
      break;
    case "stopped":
      setMicTitle("Detenido");
      break;
    case "config_updated":
      break;
    case "error":
      if (m.code === "trial_limit") {
        if (app.recording) stopMic("Prueba gratuita agotada");
        showTrialModal(m.used, m.limit);
      } else {
        toast(m.message || "Error");
        if (app.recording) stopMic("Error");
      }
      break;
    case "room_joined":
      onRoomJoined(m);
      break;
    case "member_joined":
      onMemberJoined(m.member);
      break;
    case "member_left":
      onMemberLeft(m.id);
      break;
    case "room_message":
      onRoomMessage(m);
      break;
    case "room_translation":
      onRoomTranslation(m);
      break;
    case "speaking":
      onSpeakingState(m);
      break;
    case "room_closed":
      toast("La sala ha terminado");
      backToLanding();
      break;
  }
}
