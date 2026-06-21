/**
 * protocol.ts — Tipos del protocolo cliente ⇆ servidor.
 *
 * Estos tipos describen EXACTAMENTE el contrato con tu backend (FastAPI + /ws).
 * No cambies los nombres de campos `command` / `type` sin tocar el servidor:
 * el servidor envía mensajes `{ type: ... }` y el cliente envía `{ command: ... }`.
 */

export type Mode = "idle" | "solo" | "room";
export type Engine = "openai";

/** Configuración de traducción que se sincroniza con el servidor (`update_config`). */
export interface Config {
  lang: string; // idioma de entrada ASR ("auto" = autodetectar)
  target: string; // idioma destino de la traducción
  translate: boolean;
  tts: boolean;
  voice: string;
  engine: Engine;
}

/** Una entrada de la lista de idiomas soportados. */
export interface Language {
  id: string;
  label: string; // nombre mostrado (español)
  alias: string; // términos de búsqueda (inglés/nativo)
  flag: string;
  openai: boolean; // disponible como destino en el motor OpenAI
}

export interface Member {
  id: string;
  name: string;
  color?: number;
}

export interface RoomState {
  code: string;
  name: string;
  members: Member[];
  you: string; // id del miembro local
  myTarget: string; // idioma que el usuario local escucha
}

export interface TrialInfo {
  used: number;
  limit: number;
}

export interface User {
  email: string;
  nickname: string;
  trial?: TrialInfo;
}

/**
 * Abstracción mínima de WebSocket. El WebSocket real del navegador la cumple;
 * el modo demo provee un objeto falso con la misma forma.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close?(): void;
}

/** Comando saliente genérico (cliente → servidor). */
export interface ClientCommand {
  command: string;
  [key: string]: unknown;
}

/* ============================================================
   Mensajes entrantes (servidor → cliente)
   Inputs "sueltos" sin `type` para que los manejadores y el modo
   demo puedan reutilizarlos.
   ============================================================ */

export interface SoloTranscriptInput {
  text: string;
  final?: boolean;
  incremental?: boolean;
  lang?: string;
}
export interface SoloTranslationInput {
  text: string;
  final?: boolean;
  incremental?: boolean;
}
export interface RoomMessageInput {
  turn_id: string;
  speaker_id: string;
  speaker_name?: string;
  src_lang?: string;
  text: string;
  incremental?: boolean;
  final?: boolean;
}
export interface RoomTranslationInput {
  turn_id: string;
  speaker_id: string;
  text: string;
  incremental?: boolean;
  final?: boolean;
}
export interface SpeakingInput {
  id: string;
  speaking: boolean;
}
export interface RoomJoinedInput {
  code: string;
  room_name?: string;
  members: Member[];
  you: string;
  your_target?: string;
}

export interface TranscriptMsg extends SoloTranscriptInput {
  type: "transcript";
}
export interface TranslationMsg extends SoloTranslationInput {
  type: "translation";
}
export interface AudioMsg {
  type: "audio";
  data: string;
  sample_rate: number;
}
export interface ReadyMsg {
  type: "ready";
  recording_id?: string;
}
export interface WelcomeMsg {
  type: "welcome";
  recording_id?: string;
}
export interface StoppedMsg {
  type: "stopped";
}
export interface ConfigUpdatedMsg {
  type: "config_updated";
}
export interface ErrorMsg {
  type: "error";
  code?: string;
  message?: string;
  used?: number;
  limit?: number;
}
export interface RoomJoinedMsg extends RoomJoinedInput {
  type: "room_joined";
}
export interface MemberJoinedMsg {
  type: "member_joined";
  member: Member;
}
export interface MemberLeftMsg {
  type: "member_left";
  id: string;
}
export interface RoomMessageMsg extends RoomMessageInput {
  type: "room_message";
}
export interface RoomTranslationMsg extends RoomTranslationInput {
  type: "room_translation";
}
export interface SpeakingMsg extends SpeakingInput {
  type: "speaking";
}
export interface RoomClosedMsg {
  type: "room_closed";
}

export type ServerMessage =
  | TranscriptMsg
  | TranslationMsg
  | AudioMsg
  | ReadyMsg
  | WelcomeMsg
  | StoppedMsg
  | ConfigUpdatedMsg
  | ErrorMsg
  | RoomJoinedMsg
  | MemberJoinedMsg
  | MemberLeftMsg
  | RoomMessageMsg
  | RoomTranslationMsg
  | SpeakingMsg
  | RoomClosedMsg;
