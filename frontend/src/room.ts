/**
 * room.ts — Modo sala: render del flujo de turnos traducidos y miembros.
 */
import { $, $opt, app, escapeHtml, hideEmpty, scrollDown } from "./state";
import type {
  Member,
  RoomJoinedInput,
  RoomMessageInput,
  RoomTranslationInput,
  SpeakingInput,
} from "./protocol";
import { langById } from "./languages";
import { show } from "./nav";
import { toast } from "./ui";

const roomTurns = new Map<string, HTMLElement>();

export function onRoomJoined(m: RoomJoinedInput): void {
  app.roomState = {
    code: m.code,
    name: m.room_name || "Sala",
    members: m.members,
    you: m.you,
    myTarget: m.your_target || "ru",
  };
  $("roomName").textContent = app.roomState.name;
  $("roomCode").textContent = m.code;
  const lbl = langById(app.roomState.myTarget);
  $("roomMyTarget").textContent = lbl ? lbl.label : app.roomState.myTarget;
  renderMembers();
  $("roomStream").innerHTML =
    '<div class="empty-state"><div class="big">💬</div>Sala lista<br>Pulsa el micrófono para hablar</div>';
  app.mode = "room";
  show("viewRoom");
  toast(`Conectado · Código ${m.code}`);
}

export function onMemberJoined(member: Member): void {
  if (!app.roomState) return;
  app.roomState.members.push(member);
  renderMembers();
  toast(`${member.name} se unió`);
}

export function onMemberLeft(id: string): void {
  if (!app.roomState) return;
  const left = app.roomState.members.find((x) => x.id === id);
  app.roomState.members = app.roomState.members.filter((x) => x.id !== id);
  renderMembers();
  if (left) toast(`${left.name} salió`);
}

export function onSpeakingState(m: SpeakingInput): void {
  document.querySelectorAll<HTMLElement>(".av").forEach((el) => {
    if (el.dataset.member === m.id) {
      el.classList.toggle("speaking", !!m.speaking);
    }
  });
}

function renderMembers(): void {
  const rs = app.roomState;
  if (!rs) return;
  const el = $("roomMembers");
  $("roomMembersCount").textContent = String(rs.members.length);
  let html = "";
  for (const m of rs.members) {
    const cls = m.id === rs.you ? "me" : "c" + (m.color ?? 0);
    const initial =
      m.id === rs.you ? "Yo" : (m.name || "?").charAt(0).toUpperCase();
    html += `<div class="av ${cls}" data-member="${escapeHtml(m.id)}" title="${escapeHtml(m.name)}">${escapeHtml(initial)}</div>`;
  }
  html += `<span class="who" id="memberWho">${escapeHtml(rs.members.map((x) => x.name).join(" · "))}</span>`;
  html += `<button class="invite" onclick="copyRoomCode()">+ Invitar</button>`;
  el.innerHTML = html;
}

export function copyRoomCode(): void {
  const rs = app.roomState;
  if (!rs) return;
  navigator.clipboard?.writeText(rs.code).catch(() => {});
  toast(`Código ${rs.code} copiado`);
}

export function onRoomMessage(m: RoomMessageInput): void {
  hideEmpty("roomStream");
  let turn = $opt("turn-" + m.turn_id);
  if (!turn) turn = createTurn(m);
  const srcEl = turn.querySelector<HTMLElement>(".src-text")!;
  if (m.incremental) srcEl.textContent = srcEl.textContent + m.text;
  else srcEl.textContent = m.text;
  if (m.final) turn.classList.remove("live");
  scrollDown("roomStream");
}

export function onRoomTranslation(m: RoomTranslationInput): void {
  hideEmpty("roomStream");
  let turn = $opt("turn-" + m.turn_id);
  if (!turn) turn = createTurn(m);
  const tgtEl = turn.querySelector<HTMLElement>(".tgt-text")!;
  if (m.incremental) tgtEl.textContent = tgtEl.textContent + m.text;
  else tgtEl.textContent = m.text;
  if (m.final) turn.classList.remove("live");
  else turn.classList.add("live");
  scrollDown("roomStream");
}

function createTurn(m: RoomMessageInput | RoomTranslationInput): HTMLElement {
  const rs = app.roomState;
  const member = rs?.members.find((x) => x.id === m.speaker_id);
  const name = member?.name || (m as RoomMessageInput).speaker_name || "?";
  const color = member?.color ?? 0;
  const srcLang = (m as RoomMessageInput).src_lang || "";
  const ts = new Date().toTimeString().slice(0, 8);
  const turn = document.createElement("div");
  turn.className = "turn live";
  turn.id = "turn-" + m.turn_id;
  turn.innerHTML = `
    <div class="col-av">
      <div class="av c${color}" data-member="${escapeHtml(m.speaker_id)}">${escapeHtml((name || "?").charAt(0).toUpperCase())}</div>
    </div>
    <div class="col-body">
      <div class="head-line">
        <span class="name c${color}">${escapeHtml(name)}</span>
        <span class="lang-tag-mini">${escapeHtml(srcLang.toUpperCase())}</span>
        <span class="ts">${ts}</span>
      </div>
      <div class="src-text"></div>
      <div class="tgt-text"></div>
    </div>`;
  $("roomStream").appendChild(turn);
  roomTurns.set(m.turn_id, turn);
  return turn;
}

/** Copia todo el flujo traducido de la sala al portapapeles. */
export function copyTranscript(): void {
  const stream = $opt("roomStream");
  if (!stream) return;
  const lines: string[] = [];
  stream.querySelectorAll<HTMLElement>(".turn").forEach((t) => {
    const name = t.querySelector(".name")?.textContent?.trim() || "";
    const tgt = t.querySelector(".tgt-text")?.textContent?.trim() || "";
    if (tgt) lines.push(`${name}: ${tgt}`);
  });
  if (!lines.length) {
    toast("Nada que copiar todavía");
    return;
  }
  navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
  toast("Conversación copiada");
}

export function exportRoom(): void {
  if (app.demo) {
    toast("Exportar disponible al desplegar tu servidor");
    return;
  }
  const rs = app.roomState;
  if (!rs) return;
  window.open(`/export?code=${rs.code}`, "_blank");
}
