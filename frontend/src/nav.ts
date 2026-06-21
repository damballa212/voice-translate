/**
 * nav.ts — Conmutación de vistas y navegación de alto nivel.
 */
import { app } from "./state";
import { send } from "./ws";
import { stopMic } from "./audio";
import { refreshTrialStatus } from "./auth";
import { updateLangDisplay } from "./langbar";
import { t } from "./i18n";

const ROOT_VIEWS = new Set(["viewLanding", "viewMessages", "viewSettings"]);

function updateBottomNav(viewId: string): void {
  const nav = document.getElementById("bottomNav");
  if (!nav) return;
  nav.classList.toggle("show", ROOT_VIEWS.has(viewId));
  nav.querySelectorAll<HTMLElement>(".bottom-nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === viewId);
  });
}

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
  updateBottomNav(viewId);
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

export function openHome(): void {
  backToLanding();
}

export function openSettingsRoot(): void {
  if (app.recording) stopMic(t("nav-session-closed"));
  if (app.mode === "room") {
    send({ command: "leave_room" });
  }
  app.mode = "idle";
  app.roomState = null;
  show("viewSettings");
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

export function initBottomNav(): void {
  updateBottomNav(app.currentView);
}
