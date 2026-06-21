/**
 * nav.ts — Conmutación de vistas y navegación de alto nivel.
 */
import { app } from "./state";
import { send } from "./ws";
import { stopMic } from "./audio";
import { refreshTrialStatus } from "./auth";
import { updateLangDisplay } from "./langbar";
import { t } from "./i18n";

/** Transición animada entre vistas (.view). */
export function show(viewId: string): void {
  if (viewId === app.currentView) return;
  const next = document.getElementById(viewId);
  if (!next) return;
  const prev = document.querySelector<HTMLElement>(".view.active");
  if (prev && prev !== next) {
    prev.classList.remove("active");
    prev.classList.add("exiting");
    setTimeout(() => prev.classList.remove("exiting"), 150);
    setTimeout(() => next.classList.add("active"), 90);
  } else {
    next.classList.add("active");
  }
  app.currentView = viewId;
}

export function backToLanding(): void {
  if (app.recording) stopMic(t("nav-session-closed"));
  if (app.mode === "room") {
    send({ command: "leave_room" });
  }
  app.mode = "idle";
  app.roomState = null;
  show("viewLanding");
  refreshTrialStatus();
}

export function enterSolo(): void {
  app.mode = "solo";
  show("viewSolo");
  updateLangDisplay();
}

export function leaveRoom(): void {
  backToLanding();
}
