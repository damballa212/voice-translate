/**
 * demo.ts — Modo demostración (SOLO en build de desarrollo).
 *
 * Cuando no hay backend (p. ej. `npm run dev` sin servidor), simula el flujo
 * completo: amigos de HelloTalk "hablando" en una sala, subtítulos en vivo en
 * modo individual, onda animada e historial de ejemplo. En producción nunca se
 * activa (ver `boot.ts`), así que no interfiere con el servidor real.
 */
import { $opt, app } from "./state";
import type { WebSocketLike } from "./protocol";
import { handleMessage } from "./ws";
import { resetSoloBubbles, handleSoloTranscript, handleSoloTranslation } from "./solo";
import { onRoomMessage, onRoomTranslation, onSpeakingState } from "./room";
import { onAuthSuccess } from "./auth";
import { hideBusyBanner, setMicTitle, showBusyBanner } from "./ui";
import { playMicBurst } from "./audio";
import { showPanel } from "./panels";

const _timers: number[] = [];
function dt(fn: () => void, ms: number): number {
  const t = window.setTimeout(fn, ms);
  _timers.push(t);
  return t;
}

export function startDemo(): void {
  app.demo = true;
  app.currentUser = { nickname: "Tú", email: "demo@local", trial: { used: 1, limit: 3 } };
  onAuthSuccess();
}

/** WebSocket falso: enruta los `send()` del cliente al manejador de demo. */
export function setupDemoWs(): void {
  const fake: WebSocketLike = {
    readyState: 1, // WebSocket.OPEN
    send(s: string) {
      try {
        handleDemoCommand(JSON.parse(s));
      } catch {}
    },
    close() {},
  };
  app.ws = fake;
}

/* ---------------- micrófono simulado ---------------- */
export function demoToggleMic(): void {
  const b = app.mode === "room" ? $opt("micRoom") : $opt("micSolo");
  if (app.recording) {
    demoStop();
    return;
  }
  app.recording = true;
  app.backendReady = false;
  b?.classList.add("connecting");
  if (b) playMicBurst(b);
  setMicTitle("⏳ Conectando...", true);
  showBusyBanner("Conectando...");
  if (app.mode === "solo") resetSoloBubbles();
  dt(() => {
    if (!app.recording) return;
    handleMessage({ type: "ready", recording_id: "demo-" + Date.now() });
    demoWaveStart();
    if (app.mode === "solo") demoSoloSpeak(0);
    else demoMyRoomTurn();
  }, 800);
}

function demoStop(): void {
  app.recording = false;
  app.backendReady = false;
  document
    .querySelectorAll<HTMLElement>(".mic")
    .forEach((x) => x.classList.remove("recording", "connecting"));
  hideBusyBanner();
  setMicTitle("Detenido");
  demoWaveStop();
  if (app.mode === "solo") resetSoloBubbles();
}

/* ---------------- onda animada ---------------- */
let _waveRaf: number | null = null;
function demoWaveStart(): void {
  const id = app.mode === "room" ? "waveRoom" : "waveSolo";
  const el = $opt(id);
  if (!el) return;
  if (el.children.length !== 24) {
    el.innerHTML = "";
    for (let i = 0; i < 24; i++) {
      const d = document.createElement("div");
      d.className = "wave-bar";
      el.appendChild(d);
    }
  }
  el.classList.add("live");
  const bars = el.querySelectorAll<HTMLElement>(".wave-bar");
  let t = 0;
  const tick = () => {
    if (!app.recording) return;
    t += 0.08;
    for (let i = 0; i < bars.length; i++) {
      const base = Math.abs(Math.sin(t * 1.6 + i * 0.5));
      const n = Math.random() * 0.5;
      const s = 0.08 + Math.min(1, base * 0.7 + n) * 0.9;
      bars[i].style.transform = `scaleY(${s.toFixed(3)})`;
    }
    _waveRaf = requestAnimationFrame(tick);
  };
  tick();
}
function demoWaveStop(): void {
  if (_waveRaf) cancelAnimationFrame(_waveRaf);
  _waveRaf = null;
  document.querySelectorAll<HTMLElement>(".wave-viz").forEach((el) => {
    el.classList.remove("live");
    el.querySelectorAll<HTMLElement>(".wave-bar").forEach((b) => {
      b.style.transform = "scaleY(0.06)";
    });
  });
}

/* ---------------- guion del modo individual ---------------- */
const _soloScript = [
  { src: "Hola, me alegra mucho hablar contigo hoy.", tgt: "Привет, я очень рад поговорить с тобой сегодня.", lang: "es" },
  { src: "¿Qué te gusta hacer en tu tiempo libre?", tgt: "Чем тебе нравится заниматься в свободное время?", lang: "es" },
  { src: "Me encanta aprender idiomas con amigos de todo el mundo.", tgt: "Мне нравится учить языки с друзьями со всего мира.", lang: "es" },
];

function streamWords(
  text: string,
  emit: (t: string, fin: boolean) => void,
  doneCb?: () => void,
): void {
  const words = text.split(" ");
  let i = 0;
  const step = () => {
    if (!app.recording) return;
    if (i < words.length) {
      emit((i === 0 ? "" : " ") + words[i], false);
      i++;
      dt(step, 95 + Math.random() * 70);
    } else {
      emit(text, true);
      if (doneCb) dt(doneCb, 40);
    }
  };
  step();
}

function demoSoloSpeak(idx: number): void {
  if (!app.recording) return;
  if (idx >= _soloScript.length) {
    dt(() => demoSoloSpeak(0), 2600);
    return;
  }
  const turn = _soloScript[idx];
  streamWords(
    turn.src,
    (t, fin) => {
      if (!fin) handleSoloTranscript({ text: t, incremental: true, lang: turn.lang });
    },
    () => {
      streamWords(
        turn.tgt,
        (t, fin) => {
          if (!fin) handleSoloTranslation({ text: t, incremental: true });
        },
        () => {
          handleSoloTranscript({ text: turn.src, final: true, lang: turn.lang });
          handleSoloTranslation({ text: turn.tgt, final: true });
          dt(() => demoSoloSpeak(idx + 1), 1500);
        },
      );
    },
  );
}

/* ---------------- amigos en la sala ---------------- */
interface DemoFriend {
  id: string;
  name: string;
  color: number;
  lang: string;
  lines: { src: string; tgt: string }[];
}
const _friends: DemoFriend[] = [
  {
    id: "fy", name: "Yuki", color: 1, lang: "JA",
    lines: [
      { src: "こんにちは！元気にしてた？", tgt: "¡Hola! ¿Cómo has estado?" },
      { src: "週末は何をしましたか？", tgt: "¿Qué hiciste el fin de semana?" },
      { src: "その料理、美味しそうですね！", tgt: "¡Ese plato se ve delicioso!" },
    ],
  },
  {
    id: "fd", name: "Dmitri", color: 2, lang: "RU",
    lines: [
      { src: "Привет, друзья! Рад вас видеть.", tgt: "¡Hola, amigos! Me alegra verlos." },
      { src: "Как проходит ваш день?", tgt: "¿Cómo va su día?" },
      { src: "Давайте говорить по-испански сегодня.", tgt: "Hablemos en español hoy." },
    ],
  },
  {
    id: "fa", name: "Amara", color: 3, lang: "EN",
    lines: [
      { src: "Hey everyone, this group is so much fun!", tgt: "Hola a todos, ¡este grupo es muy divertido!" },
      { src: "Your Spanish is getting really good.", tgt: "Tu español está mejorando mucho." },
    ],
  },
];
let _ambIdx = 0;
let _ambTimer: number | null = null;

function streamRoomTurn(
  speakerId: string,
  name: string,
  color: number,
  lang: string,
  src: string,
  tgt: string,
  whenDone: (() => void) | null,
): void {
  const turnId = "t" + Date.now() + Math.floor(Math.random() * 999);
  onSpeakingState({ id: speakerId, speaking: true });
  const sw = src.split(" ");
  let i = 0;
  const step = () => {
    if (app.mode !== "room") return;
    if (i < sw.length) {
      onRoomMessage({
        turn_id: turnId, speaker_id: speakerId, speaker_name: name,
        src_lang: lang, text: (i === 0 ? "" : " ") + sw[i], incremental: true,
      });
      i++;
      _ambTimer = window.setTimeout(step, 70 + Math.random() * 60);
    } else {
      onRoomMessage({ turn_id: turnId, speaker_id: speakerId, text: src, final: true });
      const tw = tgt.split(" ");
      let j = 0;
      const tstep = () => {
        if (app.mode !== "room") return;
        if (j < tw.length) {
          onRoomTranslation({
            turn_id: turnId, speaker_id: speakerId,
            text: (j === 0 ? "" : " ") + tw[j], incremental: true,
          });
          j++;
          _ambTimer = window.setTimeout(tstep, 70 + Math.random() * 60);
        } else {
          onRoomTranslation({ turn_id: turnId, speaker_id: speakerId, text: tgt, final: true });
          onSpeakingState({ id: speakerId, speaking: false });
          if (whenDone) whenDone();
        }
      };
      tstep();
    }
  };
  step();
}

function demoAmbient(): void {
  if (app.mode !== "room") return;
  const f = _friends[_ambIdx % _friends.length];
  const line = f.lines[Math.floor(_ambIdx / _friends.length) % f.lines.length];
  _ambIdx++;
  streamRoomTurn(f.id, f.name, f.color, f.lang, line.src, line.tgt, () => {
    _ambTimer = window.setTimeout(demoAmbient, 3200 + Math.random() * 2200);
  });
}

function demoMyRoomTurn(): void {
  if (app.mode !== "room") return;
  const you = app.roomState?.you || "you";
  streamRoomTurn(you, "Tú", 0, "ES", "Hola a todos, ¿me escuchan bien?", "Hello everyone, can you hear me well?", null);
}

/* ---------------- historial de ejemplo ---------------- */
export function demoOpenHistory(): void {
  showPanel("panelHistory");
  const recs = [
    { i: "🎙", n: "Charla con Yuki", m: "Hoy 14:32 · 12 entradas" },
    { i: "👥", n: "Sala — Café de idiomas", m: "Ayer 19:10 · 47 entradas" },
    { i: "🎙", n: "Práctica de ruso", m: "12 jun · 8 entradas" },
  ];
  const list = $opt("historyList");
  if (!list) return;
  list.innerHTML = recs
    .map(
      (r) =>
        `<div class="record-item"><div class="record-info"><div class="record-name">${r.i} ${r.n}</div><div class="record-meta">${r.m}</div></div><a class="record-dl" onclick="toast('Demo')">↓</a><button class="record-del" onclick="this.parentNode.parentNode.remove()">×</button></div>`,
    )
    .join("");
}

/* ---------------- enrutado de comandos del cliente ---------------- */
interface DemoCommand {
  command?: string;
  code?: string;
  room_name?: string;
  name?: string;
  [k: string]: unknown;
}

function handleDemoCommand(cmd: DemoCommand): void {
  if (!cmd || !cmd.command) return;
  switch (cmd.command) {
    case "create_room":
    case "join_room":
      dt(() => {
        const code =
          (cmd.code || "").toUpperCase() ||
          "GR" + Math.floor(1000 + Math.random() * 8999);
        handleMessage({
          type: "room_joined",
          code,
          room_name: cmd.room_name || "Café de idiomas",
          your_target: "es",
          you: "you",
          members: [
            { id: "you", name: cmd.name || "Tú", color: 0 },
            { id: "fy", name: "Yuki", color: 1 },
            { id: "fd", name: "Dmitri", color: 2 },
            { id: "fa", name: "Amara", color: 3 },
          ],
        });
        if (_ambTimer) clearTimeout(_ambTimer);
        _ambIdx = 0;
        _ambTimer = window.setTimeout(demoAmbient, 1400);
      }, 650);
      break;
    case "leave_room":
      if (_ambTimer) clearTimeout(_ambTimer);
      _ambTimer = null;
      break;
    default:
      break;
  }
}
