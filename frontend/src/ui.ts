/**
 * ui.ts — Capa de presentación pura: toasts, banner de estado, título del
 * micrófono, modal de prueba y splash de arranque.
 */
import { $, $opt } from "./state";
import { t } from "./i18n";

/* ---------------- Toast ---------------- */
let _toastTimer: number | undefined;
let _toastHideTimer: number | undefined;

export function toast(msg: string): void {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hiding");
  if (el.classList.contains("show")) {
    el.classList.remove("show");
    void el.offsetWidth;
  }
  el.classList.add("show");
  clearTimeout(_toastTimer);
  clearTimeout(_toastHideTimer);
  _toastTimer = window.setTimeout(() => {
    el.classList.add("hiding");
    _toastHideTimer = window.setTimeout(
      () => el.classList.remove("show", "hiding"),
      180,
    );
  }, 2400);
}

/* ---------------- Banner "ocupado" ---------------- */
export function showBusyBanner(text?: string): void {
  const el = $opt("busyBanner");
  const tx = $opt("busyBannerText");
  if (tx && text) tx.textContent = text;
  el?.classList.add("show");
}

export function hideBusyBanner(): void {
  $opt("busyBanner")?.classList.remove("show");
}

/* ---------------- Título del micrófono (solo + room) ---------------- */
export function setMicTitle(s: string, warn = false): void {
  [$opt("micSoloTitle"), $opt("micRoomTitle")].forEach((el) => {
    if (!el) return;
    el.textContent = s;
    el.classList.toggle("warn", warn);
  });
}

/* ---------------- Modal de límite de prueba ---------------- */
export function showTrialModal(used?: number, limit?: number): void {
  const el = $opt("trialModal");
  const cnt = $opt("trialCount");
  if (cnt && used != null && limit != null) {
    cnt.textContent = t("trial-count-template", {
      used: String(used),
      limit: String(limit),
    });
  }
  if (el) {
    el.classList.remove("closing");
    el.classList.add("show");
  }
}

export function closeTrialModal(): void {
  const el = $opt("trialModal");
  if (!el) return;
  el.classList.add("closing");
  setTimeout(() => el.classList.remove("show", "closing"), 150);
}

/* ---------------- Splash de arranque ---------------- */
export function initSplash(): void {
  const SEEN = "splash-seen=1";
  const el = $opt("splash");
  if (!el) return;
  if (document.cookie.indexOf(SEEN) !== -1) {
    el.remove();
    return;
  }
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => {
      el.remove();
      const active = document.querySelector<HTMLElement>(".view.active");
      if (active) {
        active.classList.remove("active");
        void active.offsetWidth;
        active.classList.add("active");
      }
    }, 280);
    document.cookie = "splash-seen=1; max-age=31536000; path=/; samesite=lax";
  }, 1200);
}
