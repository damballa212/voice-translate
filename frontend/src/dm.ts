/**
 * dm.ts — Mensajeria persistente 1:1 por email.
 */
import { $, $opt, app, escapeHtml, scrollDown, config } from "./state";
import type { DmConversation, DmMessage, DmMessageMsg, DmBubbleTranslationMsg } from "./protocol";
import { send } from "./ws";
import { show } from "./nav";
import { showPanel, closeOverlay } from "./panels";
import { stopMic } from "./audio";
import { toast } from "./ui";
import { startRecording, stopRecording, cancelRecording, toggleVoiceNote } from "./voiceNote";
import { t } from "./i18n";

let conversations: DmConversation[] = [];
let activeConversation: DmConversation | null = null;
const renderedMessages = new Map<number, DmMessage>();
let lastRenderedSenderId = 0;
let lastRenderedDateStr = "";
let pendingIdCounter = -1;
let replyToMessage: DmMessage | null = null;

function currentUserId(): number {
  return Number(app.currentUser?.id || 0);
}

function formatHour(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t("dm-date-today") || "Hoy";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t("dm-date-yesterday") || "Ayer";
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function dateKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatListTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatHour(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function messagePreview(message?: DmMessage | null): string {
  if (!message) return t("dm-preview-empty");
  if (message.kind === "image") return "📷 Imagen";
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
          <span>${escapeHtml(formatListTime(c.updated_at))}</span>
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
  if (input) { input.value = ""; setTimeout(() => input.focus(), 50); }
}

export async function doCreateDm(): Promise<void> {
  const input = $<HTMLInputElement>("newDmEmail");
  const email = input.value.trim();
  if (!email) { toast(t("dm-email-required")); return; }
  try {
    const r = await fetch("/dm/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.detail || t("dm-create-error")); return; }
    const conv = await r.json();
    closeOverlay();
    await loadConversations();
    openChat(conv.id);
  } catch { toast(t("toast-network-error")); }
}

export async function openChat(id: number): Promise<void> {
  let conv = conversations.find((c) => c.id === id) || null;
  if (!conv) { await loadConversations(); conv = conversations.find((c) => c.id === id) || null; }
  if (!conv) { toast(t("dm-chat-not-found")); return; }
  activeConversation = conv;
  renderedMessages.clear();
  lastRenderedSenderId = 0;
  lastRenderedDateStr = "";
  clearReply();
  $("chatName").textContent = conv.participant.nickname || conv.participant.email;
  $("chatMeta").textContent = conv.participant.email;
  $("chatAvatar").textContent = (conv.participant.nickname || conv.participant.email).charAt(0).toUpperCase();
  $("chatMessages").innerHTML = `<div class="record-empty">${escapeHtml(t("dm-loading"))}</div>`;
  show("viewChat");
  const myLang = (conv.my_target_lang || config.target || "en");
  const sel = $opt<HTMLSelectElement>("chatLangSelect");
  if (sel) sel.value = myLang;
  send({ command: "dm_set_lang", conversation_id: id, target_lang: myLang });
  await loadMessages(id);
  setupClipboardPaste();
}

function setupClipboardPaste(): void {
  const input = $opt<HTMLInputElement>("chatInput");
  if (!input) return;
  input.addEventListener("paste", (ev: ClipboardEvent) => {
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        ev.preventDefault();
        const file = items[i].getAsFile();
        if (file) showImagePreview(file);
        return;
      }
    }
  });
}

async function loadMessages(id: number): Promise<void> {
  try {
    const r = await fetch(`/dm/conversations/${id}/messages`);
    if (!r.ok) throw new Error("messages failed");
    const messages = (await r.json()) as DmMessage[];
    const el = $("chatMessages");
    el.innerHTML = "";
    renderedMessages.clear();
    lastRenderedSenderId = 0;
    lastRenderedDateStr = "";
    messages.forEach((m) => renderMessage(m, false));
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

function renderReplyQuote(message: DmMessage): string {
  const rp = message.reply_preview;
  if (!rp) return "";
  const mine = message.sender_user_id === currentUserId();
  const borderColor = mine ? "#06d755" : "#6b7280";
  const name = escapeHtml(rp.sender_name || "");
  const preview = escapeHtml(rp.body || "");
  return `<div class="reply-quote" onclick="scrollToMessage(${rp.id})" style="border-left-color:${borderColor}">
    <span class="reply-quote-name">${name}</span>
    <span class="reply-quote-text">${preview}</span>
  </div>`;
}

function renderMessage(message: DmMessage, animate: boolean): void {
  if (renderedMessages.has(message.id)) return;
  renderedMessages.set(message.id, message);
  const el = $("chatMessages");
  const empty = el.querySelector(".dm-empty, .record-empty");
  if (empty) empty.remove();
  const mine = message.sender_user_id === currentUserId();
  const ts = message.created_at;
  const dk = dateKey(ts);

  if (dk !== lastRenderedDateStr) {
    lastRenderedDateStr = dk;
    const sep = document.createElement("div");
    sep.className = "chat-date-sep";
    sep.textContent = formatDateLabel(ts);
    el.appendChild(sep);
    lastRenderedSenderId = 0;
  }

  const isTail = message.sender_user_id !== lastRenderedSenderId;
  lastRenderedSenderId = message.sender_user_id;

  const div = document.createElement("div");
  div.className = `chat-bubble ${mine ? "out" : "in"}${isTail ? " tail" : ""}`;
  div.id = `dm-msg-${message.id}`;
  div.dataset.messageId = String(message.id);
  if (animate) div.style.animation = "trans-in .2s ease-out";

  const translationKey = mine
    ? (activeConversation?.participant?.native_lang || "")
    : (app.currentUser?.native_lang || "");

  if (message.reply_preview) {
    div.innerHTML += renderReplyQuote(message);
  }

  if (message.kind === "image" && message.image_url) {
    div.classList.add("img-bubble");
    const img = document.createElement("img");
    img.className = "chat-img";
    img.src = `/dm/image/${message.id}`;
    img.alt = "Imagen";
    img.onload = () => { img.style.minHeight = "0"; img.style.aspectRatio = "auto"; img.style.background = "none"; };
    img.onclick = () => openLightbox(img.src);
    div.appendChild(img);
  } else if (message.kind === "voice") {
    const secs = Math.max(0, Math.round((message.voice_duration_ms || 0) / 1000));
    const hasTranscript = message.transcript && message.transcript.trim();
    const translatedText = translationKey ? (message.translations_json?.[translationKey] || "") : "";
    const voiceHtml = `<button class="voice-bubble" onclick="playDmVoice(${message.id})">
      <span class="voice-play">▶</span>
      <span class="voice-slider-wrap"><span class="voice-slider-fill"></span></span>
      <span class="voice-duration">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</span>
    </button>${hasTranscript ? `<span class="chat-transcript">${escapeHtml(message.transcript!)}</span>` : ""}${translatedText ? `<span class="chat-translation">${escapeHtml(translatedText)}</span>` : ""}`;
    div.insertAdjacentHTML("beforeend", voiceHtml);
  } else {
    const bodyEl = document.createElement("span");
    bodyEl.className = "chat-body";
    bodyEl.textContent = message.body || "";
    div.appendChild(bodyEl);
    const translatedText = translationKey ? (message.translations_json?.[translationKey] || "") : "";
    if (translatedText) {
      const transEl = document.createElement("span");
      transEl.className = "chat-translation";
      transEl.textContent = translatedText;
      div.appendChild(transEl);
    }
  }

  const timeMeta = document.createElement("span");
  timeMeta.className = "chat-time";
  timeMeta.innerHTML = `${formatHour(ts)}${mine ? '<span class="chat-tick read">✓✓</span>' : ""}`;
  div.appendChild(timeMeta);

  div.addEventListener("contextmenu", (ev) => { ev.preventDefault(); showBubbleMenu(message, div); });
  div.addEventListener("pointerdown", makeLongPressHandler(message, div));
  initSwipeToReply(div, message);
  el.appendChild(div);
  scrollDown("chatMessages");
}

// ============================================================
// Swipe to reply (WhatsApp style)
// ============================================================
const SWIPE_THRESHOLD = 70;
const SWIPE_MAX = 100;

function initSwipeToReply(div: HTMLElement, message: DmMessage): void {
  let startX = 0;
  let startY = 0;
  let swiping = false;
  let locked = false;
  let triggered = false;

  const onStart = (e: TouchEvent | MouseEvent) => {
    const pt = "touches" in e ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    swiping = false;
    locked = false;
    triggered = false;
    div.style.transition = "none";
  };

  const onMove = (e: TouchEvent | MouseEvent) => {
    const pt = "touches" in e ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;

    if (!locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { locked = true; return; }
      if (Math.abs(dx) > 10) { swiping = true; locked = true; }
      else return;
    }
    if (!swiping) return;

    if (dx > 0) {
      if ("cancelable" in e && e.cancelable) e.preventDefault();
      const clamped = Math.min(dx, SWIPE_MAX);
      div.style.transform = `translateX(${clamped}px)`;
      const icon = div.querySelector<HTMLElement>(".swipe-reply-icon");
      if (icon) {
        const progress = Math.min(clamped / SWIPE_THRESHOLD, 1);
        icon.style.opacity = String(progress);
        icon.style.transform = `scale(${0.5 + progress * 0.5})`;
      }
      if (clamped >= SWIPE_THRESHOLD && !triggered) {
        triggered = true;
        if (navigator.vibrate) navigator.vibrate(20);
      }
    }
  };

  const onEnd = () => {
    div.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
    div.style.transform = "";
    const icon = div.querySelector<HTMLElement>(".swipe-reply-icon");
    if (icon) { icon.style.opacity = "0"; icon.style.transform = "scale(0.5)"; }
    if (triggered) setReply(message);
    swiping = false;
  };

  div.style.position = "relative";
  const icon = document.createElement("span");
  icon.className = "swipe-reply-icon";
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>`;
  div.appendChild(icon);

  div.addEventListener("touchstart", onStart, { passive: true });
  div.addEventListener("touchmove", onMove, { passive: false });
  div.addEventListener("touchend", onEnd);
  div.addEventListener("mousedown", onStart);
  div.addEventListener("mousemove", onMove);
  div.addEventListener("mouseup", onEnd);
}

// ============================================================
// Reply system
// ============================================================
function setReply(message: DmMessage): void {
  replyToMessage = message;
  const bar = $opt("chatReplyBar");
  if (!bar) return;
  const mine = message.sender_user_id === currentUserId();
  const name = mine
    ? (app.currentUser?.nickname || "Tú")
    : (activeConversation?.participant?.nickname || "");
  let preview = message.body || message.transcript || "";
  if (message.kind === "image") preview = "📷 Imagen";
  if (message.kind === "voice") preview = "🎙 Nota de voz";
  bar.innerHTML = `<div class="reply-bar-content">
    <span class="reply-bar-name">${escapeHtml(name)}</span>
    <span class="reply-bar-text">${escapeHtml(preview.slice(0, 80))}</span>
  </div><button class="reply-bar-close" onclick="clearReply()">✕</button>`;
  bar.style.display = "flex";
  $opt<HTMLInputElement>("chatInput")?.focus();
}

export function clearReply(): void {
  replyToMessage = null;
  const bar = $opt("chatReplyBar");
  if (bar) bar.style.display = "none";
}

export function scrollToMessage(msgId: number): void {
  const el = document.getElementById(`dm-msg-${msgId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("highlight");
  setTimeout(() => el.classList.remove("highlight"), 1500);
}

// ============================================================
// Image upload + preview + lightbox
// ============================================================
export function triggerImageUpload(): void {
  const input = $opt<HTMLInputElement>("chatImageInput");
  if (input) input.click();
}

export function onImageFileSelected(): void {
  const input = $opt<HTMLInputElement>("chatImageInput");
  if (!input?.files?.length) return;
  showImagePreview(input.files[0]);
  input.value = "";
}

function showImagePreview(file: File): void {
  if (!file.type.startsWith("image/")) { toast("Solo se permiten imágenes"); return; }
  if (file.size > 10 * 1024 * 1024) { toast("Imagen demasiado grande (max 10MB)"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const modal = $opt("imagePreviewModal");
    const img = $opt<HTMLImageElement>("imagePreviewImg");
    if (!modal || !img) return;
    img.src = reader.result as string;
    (modal as HTMLElement & { _file?: File })._file = file;
    modal.style.display = "flex";
  };
  reader.readAsDataURL(file);
}

export function cancelImagePreview(): void {
  const modal = $opt("imagePreviewModal");
  if (modal) modal.style.display = "none";
}

export async function sendImagePreview(): Promise<void> {
  const modal = $opt("imagePreviewModal") as HTMLElement & { _file?: File } | null;
  if (!modal?._file || !activeConversation) return;
  const file = modal._file;
  modal.style.display = "none";
  toast("Enviando imagen...");

  const headers: Record<string, string> = { "Content-Type": file.type };
  if (replyToMessage) {
    headers["X-Reply-To-Id"] = String(replyToMessage.id);
    clearReply();
  }

  try {
    const r = await fetch(`/dm/conversations/${activeConversation.id}/image`, {
      method: "POST",
      headers,
      body: file,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.detail || "Error subiendo imagen"); }
  } catch { toast(t("toast-network-error")); }
}

export function openLightbox(src: string): void {
  const lb = $opt("lightbox");
  const img = $opt<HTMLImageElement>("lightboxImg");
  if (!lb || !img) return;
  img.src = src;
  lb.style.display = "flex";
}

export function closeLightbox(): void {
  const lb = $opt("lightbox");
  if (lb) lb.style.display = "none";
}

// ============================================================
// Bubble context menu
// ============================================================
let _activeBubbleMenu: HTMLElement | null = null;

function dismissBubbleMenu(): void {
  _activeBubbleMenu?.remove();
  _activeBubbleMenu = null;
}

function showBubbleMenu(message: DmMessage, bubbleEl: HTMLElement): void {
  dismissBubbleMenu();
  const menu = document.createElement("div");
  menu.className = "bubble-menu";
  const text = message.body || message.transcript || "";
  const mine = message.sender_user_id === currentUserId();
  const translationKey = mine
    ? (activeConversation?.participant?.native_lang || "")
    : (app.currentUser?.native_lang || "");
  const actions: Array<{ label: string; action: () => void }> = [];

  actions.push({
    label: t("bubble-menu-reply") || "Responder",
    action: () => { setReply(message); dismissBubbleMenu(); },
  });

  if (text) {
    actions.push({
      label: t("bubble-menu-translate"),
      action: () => {
        if (translationKey) send({ command: "dm_translate_bubble", message_id: message.id, target_lang: translationKey });
        dismissBubbleMenu();
      },
    });
    actions.push({
      label: t("bubble-menu-tts"),
      action: () => {
        dismissBubbleMenu();
        const audio = new Audio(`/dm/tts/${message.id}`);
        audio.play().catch(() => toast(t("dm-voice-play-error")));
      },
    });
    actions.push({
      label: t("bubble-menu-copy"),
      action: () => {
        navigator.clipboard?.writeText(text).catch(() => {});
        toast(t("bubble-menu-copied"));
        dismissBubbleMenu();
      },
    });
  }
  if (!actions.length) return;
  actions.forEach(({ label, action }) => {
    const btn = document.createElement("button");
    btn.className = "bubble-menu-btn";
    btn.textContent = label;
    btn.addEventListener("click", action);
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  _activeBubbleMenu = menu;
  const rect = bubbleEl.getBoundingClientRect();
  const menuH = actions.length * 44;
  let top = rect.top - menuH - 8;
  if (top < 8) top = rect.bottom + 8;
  menu.style.top = `${top + window.scrollY}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 170))}px`;
  const dismiss = (ev: Event) => {
    if (!menu.contains(ev.target as Node)) { dismissBubbleMenu(); document.removeEventListener("pointerdown", dismiss); }
  };
  setTimeout(() => document.addEventListener("pointerdown", dismiss), 50);
}

function makeLongPressHandler(message: DmMessage, bubbleEl: HTMLElement) {
  return (ev: PointerEvent) => {
    if (ev.pointerType === "mouse") return;
    const timer = setTimeout(() => showBubbleMenu(message, bubbleEl), 500);
    const cancel = () => clearTimeout(timer);
    bubbleEl.addEventListener("pointerup", cancel, { once: true });
    bubbleEl.addEventListener("pointermove", cancel, { once: true });
  };
}

export function onDmBubbleTranslation(m: DmBubbleTranslationMsg): void {
  const bubbleEl = document.getElementById(`dm-msg-${m.message_id}`);
  if (!bubbleEl) return;
  let transEl = bubbleEl.querySelector<HTMLElement>(".chat-translation");
  if (!transEl) {
    transEl = document.createElement("span");
    transEl.className = "chat-translation";
    const timeEl = bubbleEl.querySelector(".chat-time");
    bubbleEl.insertBefore(transEl, timeEl || null);
  }
  transEl.textContent = m.translated;
}

// ============================================================
// Send text
// ============================================================
export function sendChatText(): void {
  if (!activeConversation) return;
  const input = $<HTMLInputElement>("chatInput");
  const body = input.value.trim();
  if (!body) return;
  input.value = "";

  const tempId = pendingIdCounter--;
  const now = Date.now() / 1000;
  const optimistic: DmMessage = {
    id: tempId,
    conversation_id: activeConversation.id,
    sender_user_id: currentUserId(),
    kind: "text",
    body,
    voice_path: null, voice_mime: null, voice_duration_ms: null, voice_size_bytes: null,
    translations_json: {},
    transcript: null,
    image_url: null,
    reply_to_id: replyToMessage?.id || null,
    reply_preview: replyToMessage ? {
      id: replyToMessage.id,
      sender_user_id: replyToMessage.sender_user_id,
      sender_name: replyToMessage.sender_user_id === currentUserId()
        ? (app.currentUser?.nickname || "Tú")
        : (activeConversation?.participant?.nickname || ""),
      kind: replyToMessage.kind,
      body: replyToMessage.body || replyToMessage.transcript || (replyToMessage.kind === "image" ? "📷 Imagen" : ""),
    } : null,
    created_at: now,
    deleted_at: null,
    is_voice: false,
  };
  renderMessage(optimistic, true);
  const pending = document.getElementById(`dm-msg-${tempId}`);
  if (pending) pending.classList.add("sending");

  const cmd: { command: string; conversation_id: number; body: string; reply_to?: number } = {
    command: "dm_send_text", conversation_id: activeConversation.id, body,
  };
  if (replyToMessage) cmd.reply_to = replyToMessage.id;
  send(cmd);
  clearReply();
  updateActionBtn();
}

export function onChatInputKey(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); sendChatText(); }
}

export function onDmMessage(m: DmMessageMsg): void {
  if (activeConversation?.id === m.message.conversation_id) {
    const isMine = m.message.sender_user_id === currentUserId();
    if (isMine) {
      const pendingEls = document.querySelectorAll<HTMLElement>(".chat-bubble.sending");
      if (pendingEls.length > 0) {
        const lastPending = pendingEls[pendingEls.length - 1];
        const oldId = Number(lastPending.dataset.messageId);
        renderedMessages.delete(oldId);
        lastPending.remove();
        lastRenderedSenderId = 0;
        const allBubbles = document.querySelectorAll<HTMLElement>(".chat-bubble");
        if (allBubbles.length > 0) {
          const last = allBubbles[allBubbles.length - 1];
          const lastMsgId = Number(last.dataset.messageId);
          const lastMsg = renderedMessages.get(lastMsgId);
          if (lastMsg) lastRenderedSenderId = lastMsg.sender_user_id;
        }
      }
    }
    renderMessage(m.message, true);
    send({ command: "dm_mark_read", conversation_id: m.message.conversation_id, message_id: m.message.id });
  }
  loadConversations();
}

export function backToMessages(): void {
  activeConversation = null;
  openMessages();
}

export function toggleChatVoiceNote(): void {
  if (!activeConversation) return;
  toggleVoiceNote(activeConversation.id, (message) => { renderMessage(message, true); loadConversations(); });
}

export function startChatVoice(): void {
  if (!activeConversation) return;
  startRecording(activeConversation.id, (message) => { renderMessage(message, true); loadConversations(); });
}

export function stopChatVoice(): void { stopRecording(); }
export function cancelChatVoice(): void { cancelRecording(); }

// ============================================================
// Audio playback
// ============================================================
let _activeAudio: HTMLAudioElement | null = null;
let _activeAudioId = 0;

export function playDmVoice(messageId: number): void {
  if (_activeAudio && _activeAudioId === messageId) {
    if (_activeAudio.paused) { _activeAudio.play().catch(() => {}); return; }
    _activeAudio.pause();
    return;
  }
  if (_activeAudio) { _activeAudio.pause(); resetAudioUI(_activeAudioId); }

  const audio = new Audio(`/dm/voice/${messageId}`);
  _activeAudio = audio;
  _activeAudioId = messageId;

  const bubble = document.getElementById(`dm-msg-${messageId}`);
  const playBtn = bubble?.querySelector<HTMLElement>(".voice-play");
  const fill = bubble?.querySelector<HTMLElement>(".voice-slider-fill");
  const durEl = bubble?.querySelector<HTMLElement>(".voice-duration");

  if (playBtn) playBtn.textContent = "⏸";

  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    if (fill) fill.style.width = `${pct}%`;
    if (durEl) {
      const remaining = Math.max(0, Math.ceil(audio.duration - audio.currentTime));
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      durEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
    }
  });
  audio.addEventListener("ended", () => { resetAudioUI(messageId); _activeAudio = null; _activeAudioId = 0; });
  audio.addEventListener("pause", () => { if (playBtn && !audio.ended) playBtn.textContent = "▶"; });
  audio.addEventListener("play", () => { if (playBtn) playBtn.textContent = "⏸"; });
  audio.play().catch(() => { toast(t("dm-voice-play-error")); resetAudioUI(messageId); });
}

function resetAudioUI(messageId: number): void {
  const bubble = document.getElementById(`dm-msg-${messageId}`);
  const playBtn = bubble?.querySelector<HTMLElement>(".voice-play");
  const fill = bubble?.querySelector<HTMLElement>(".voice-slider-fill");
  if (playBtn) playBtn.textContent = "▶";
  if (fill) fill.style.width = "0%";
}

// ============================================================
// Action button (mic/send)
// ============================================================
function hasText(): boolean {
  const input = $opt<HTMLInputElement>("chatInput");
  return !!(input && input.value.trim());
}

function updateActionBtn(): void {
  const mic = $opt("actionBtnMic");
  const snd = $opt("actionBtnSend");
  if (!mic || !snd) return;
  const text = hasText();
  mic.style.display = text ? "none" : "";
  snd.style.display = text ? "" : "none";
}

export function onChatInputChange(): void { updateActionBtn(); }

export function onActionBtnDown(ev: Event): void {
  ev.preventDefault();
  if (hasText()) return;
  startChatVoice();
}

export function onActionBtnUp(ev: Event): void {
  ev.preventDefault();
  if (hasText()) { sendChatText(); updateActionBtn(); return; }
  stopChatVoice();
}

export function onChatLangChange(lang: string): void {
  if (!activeConversation) return;
  activeConversation.my_target_lang = lang;
  send({ command: "dm_set_lang", conversation_id: activeConversation.id, target_lang: lang });
}
