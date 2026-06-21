/**
 * boot.ts — Inicialización: rellena selects de idioma, comprueba sesión y
 * arranca la vista correspondiente (auth / landing / demo).
 */
import { $opt, app, config } from "./state";
import { COMMON_LANGS } from "./languages";
import { updateLangDisplay, pushConfig } from "./langbar";
import { onAuthSuccess } from "./auth";
import { show } from "./nav";
import { openJoinRoom } from "./panels";
import { startDemo } from "./demo";

export async function init(): Promise<void> {
  // Rellena los <select> de idioma.
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

  // Sincroniza config al cambiar los selects de ajustes.
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

  // Comprueba sesión. En desarrollo sin backend → modo demo.
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

  // ?room=XXX → abre el panel de unirse tras login.
  const params = new URLSearchParams(location.search);
  const roomCode = params.get("room");
  if (roomCode && app.currentUser) {
    $opt<HTMLInputElement>("joinCode")!.value = roomCode.toUpperCase();
    setTimeout(() => openJoinRoom(), 400);
  }
}
