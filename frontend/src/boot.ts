/**
 * boot.ts — Inicialización: detecta idioma, traduce la UI estática, rellena
 * selects de idioma, comprueba sesión y arranca la vista correspondiente.
 */
import { $opt, app, config } from "./state";
import { COMMON_LANGS } from "./languages";
import { updateLangDisplay, pushConfig } from "./langbar";
import { onAuthSuccess } from "./auth";
import { show } from "./nav";
import { openJoinRoom } from "./panels";
import { startDemo } from "./demo";
import { t } from "./i18n";
import { openChat } from "./dm";

/** Translate all static HTML elements marked with data-i18n attributes. */
function translateStaticHTML(): void {
  document.title = t("page-title");

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml!;
    el.innerHTML = t(key);
  });

  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder!;
    el.placeholder = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle!;
    el.title = t(key);
  });
}

export async function init(): Promise<void> {
  translateStaticHTML();

  const opts = COMMON_LANGS.map(
    (l) => `<option value="${l.id}">${l.label}</option>`,
  ).join("");
  const tgtOpts = COMMON_LANGS.filter((l) => l.id !== "auto")
    .map((l) => `<option value="${l.id}">${l.label}</option>`)
    .join("");

  (["setAsrLang", "setTargetLang", "createTarget", "joinTarget"] as const).forEach(
    (id) => {
      const el = $opt<HTMLSelectElement>(id);
      if (!el) return;
      el.innerHTML = id === "setAsrLang" ? opts : tgtOpts;
      if (id.includes("Target")) el.value = "ru";
      if (id === "setAsrLang") el.value = "auto";
    },
  );

  (["setAsrLang", "setTargetLang"] as const).forEach((id) => {
    const el = $opt<HTMLSelectElement>(id);
    if (!el) return;
    el.onchange = () => {
      if (id === "setAsrLang") config.lang = el.value;
      else config.target = el.value;
      updateLangDisplay();
      pushConfig();
    };
  });

  updateLangDisplay();

  try {
    const r = await fetch("/auth/me");
    if (r.ok) {
      app.currentUser = await r.json();
      onAuthSuccess();
    } else if (import.meta.env.DEV) {
      startDemo();
    } else {
      show("viewAuth");
    }
  } catch {
    if (import.meta.env.DEV) startDemo();
    else show("viewAuth");
  }

  const params = new URLSearchParams(location.search);
  const roomCode = params.get("room");
  if (roomCode && app.currentUser) {
    $opt<HTMLInputElement>("joinCode")!.value = roomCode.toUpperCase();
    setTimeout(() => openJoinRoom(), 400);
  }
  const chatId = Number(params.get("chat") || 0);
  if (chatId && app.currentUser) {
    setTimeout(() => openChat(chatId), 400);
  }
}
