/**
 * dm.ts — Mensajeria persistente 1:1 por email.
 */
import { $, $opt, app, escapeHtml, scrollDown } from "./state";
import type { DmConversation, DmMessage, DmMessageMsg } from "./protocol";
import { send } from "./ws";
import { show } from "./nav";
import { showPanel, closeOverlay } from "./panels";
import { stopMic } from "./audio";
import { toast } from "./ui";
import { toggleVoiceNote } from "./voiceNote";
import { t } from "./i18n";

let conversations: DmConversation[] = [];
let activeConversation: DmConversation | null = null;
const renderedMessages = new Set<number>();

function currentUserId(): number {
  return Number(app.currentUser?.id || 0);
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function messagePreview(message?: DmMessage | null): string {
  if (!message) return t("dm-preview-empty");
  if (message.kind === "voice") {
    const secs = Math.max(0, Math.round((message.voice_duration_ms || 0) / 1000));
    return `${t("dm-preview-voice")} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  }
  return message.body || "";
}

export async function openMessages(): Promise<void> {
  if (app.recording) stopMic(t("nav-session-closed"));
  app.mode = "idle";
  app.roomState = null;
  show("viewMessages");
  await loadConversations();
}

export async function loadConversations(): Promise<void> {
  const list = $("dmConversationList");
  list.innerHTML = `<div class="record-empty">${escapeHtml(t("dm-loading"))}</div>`;
  try {
    const r = await fetch("/dm/conversations");
    if (!r.ok) throw new Error("load failed");
    conversations = await r.json();
    renderConversations();
  } catch {
    list.innerHTML = `<div class="record-empty">${escapeHtml(t("dm-load-error"))}</div>`;
  }
}

export function renderConversations(): void {
  const list = $("dmConversationList");
  const q = ($opt<HTMLInputElement>("dmSearch")?.value || "").trim().toLowerCase();
  const filtered = conversations.filter((c) => {
    const p = c.participant;
    return !q || p.nickname.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });
  if (!filtered.length) {
    list.innerHTML = `<div class="dm-empty">
      <div class="big">💬</div>
      <b>${escapeHtml(t("dm-empty-title"))}</b>
      <span>${escapeHtml(t("dm-empty-desc"))}</span>
    </div>`;
    return;
  }
  list.innerHTML = filtered.map((c) => {
    const p = c.participant;
    const initials = (p.nickname || p.email || "?").charAt(0).toUpperCase();
    const unread = c.unread_count ? `<span class="dm-unread">${c.unread_count}</span>` : "";
    return `<button class="dm-thread" onclick="openChat(${c.id})">
      <span class="dm-avatar">${escapeHtml(initials)}</span>
      <span class="dm-thread-body">
        <span class="dm-thread-top">
          <b>${escapeHtml(p.nickname || p.email)}</b>
          <span>${escapeHtml(formatTime(c.updated_at))}</span>
        </span>
        <span class="dm-thread-bottom">
          <span>${escapeHtml(messagePreview(c.last_message))}</span>
          ${unread}
        </span>
      </span>
    </button>`;
  }).join("");
}

export function openNewDm(): void {
  showPanel("panelNewDm");
  const input = $opt<HTMLInputElement>("newDmEmail");
  if (input) {
    input.value = "";
    setTimeout(() => input.focus(), 50);
  }
}

export async function doCreateDm(): Promise<void> {
  const input = $<HTMLInputElement>("newDmEmail");
  const email = input.value.trim();
  if (!email) {
    toast(t("dm-email-required"));
    return;
  }
  try {
    const r = await fetch("/dm/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      toast(e.detail || t("dm-create-error"));
      return;
    }
    const conv = await r.json();
    closeOverlay();
    await loadConversations();
    openChat(conv.id);
  } catch {
    toast(t("toast-network-error"));
  }
}

export async function openChat(id: number): Promise<void> {
  let conv = conversations.find((c) => c.id === id) || null;
  if (!conv) {
    await loadConversations();
    conv = conversations.find((c) => c.id === id) || null;
  }
  if (!conv) {
    toast(t("dm-chat-not-found"));
    return;
  }
  activeConversation = conv;
  renderedMessages.clear();
  $("chatName").textContent = conv.participant.nickname || conv.participant.email;
  $("chatMeta").textContent = conv.participant.email;
  $("chatAvatar").textContent = (conv.participant.nickname || conv.participant.email).charAt(0).toUpperCase();
  $("chatMessages").innerHTML = `<div class="record-empty">${escapeHtml(t("dm-loading"))}</div>`;
  show("viewChat");
  await loadMessages(id);
}

async function loadMessages(id: number): Promise<void> {
  try {
    const r = await fetch(`/dm/conversations/${id}/messages`);
    if (!r.ok) throw new Error("messages failed");
    const messages = (await r.json()) as DmMessage[];
    const el = $("chatMessages");
    el.innerHTML = "";
    renderedMessages.clear();
    messages.forEach(renderMessage);
    if (!messages.length) {
      el.innerHTML = `<div class="dm-empty"><div class="big">💬</div><b>${escapeHtml(t("dm-chat-empty-title"))}</b><span>${escapeHtml(t("dm-chat-empty-desc"))}</span></div>`;
    }
    const last = messages[messages.length - 1];
    if (last) send({ command: "dm_mark_read", conversation_id: id, message_id: last.id });
    scrollDown("chatMessages");
  } catch {
    $("chatMessages").innerHTML = `<div class="record-empty">${escapeHtml(t("dm-load-error"))}</div>`;
  }
}

function renderMessage(message: DmMessage): void {
  if (renderedMessages.has(message.id)) return;
  renderedMessages.add(message.id);
  const el = $("chatMessages");
  const empty = el.querySelector(".dm-empty, .record-empty");
  if (empty) empty.remove();
  const mine = message.sender_user_id === currentUserId();
  const div = document.createElement("div");
  div.className = `chat-bubble ${mine ? "out" : "in"}`;
  div.id = `dm-msg-${message.id}`;
  if (message.kind === "voice") {
    const secs = Math.max(0, Math.round((message.voice_duration_ms || 0) / 1000));
    div.innerHTML = `<button class="voice-bubble" onclick="playDmVoice(${message.id})">
      <span class="voice-play">▶</span>
      <span class="voice-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <span class="voice-duration">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</span>
    </button>`;
  } else {
    div.textContent = message.body || "";
  }
  const time = document.createElement("span");
  time.className = "chat-time";
  time.textContent = formatTime(message.created_at);
  div.appendChild(time);
  el.appendChild(div);
  scrollDown("chatMessages");
}

export function sendChatText(): void {
  if (!activeConversation) return;
  const input = $<HTMLInputElement>("chatInput");
  const body = input.value.trim();
  if (!body) return;
  input.value = "";
  send({ command: "dm_send_text", conversation_id: activeConversation.id, body });
}

export function onChatInputKey(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    sendChatText();
  }
}

export function onDmMessage(m: DmMessageMsg): void {
  if (activeConversation?.id === m.message.conversation_id) {
    renderMessage(m.message);
    send({
      command: "dm_mark_read",
      conversation_id: m.message.conversation_id,
      message_id: m.message.id,
    });
  }
  loadConversations();
}

export function backToMessages(): void {
  activeConversation = null;
  openMessages();
}

export function toggleChatVoiceNote(): void {
  if (!activeConversation) return;
  toggleVoiceNote(activeConversation.id, (message) => {
    renderMessage(message);
    loadConversations();
  });
}

export function playDmVoice(messageId: number): void {
  const audio = new Audio(`/dm/voice/${messageId}`);
  audio.play().catch(() => toast(t("dm-voice-play-error")));
}
