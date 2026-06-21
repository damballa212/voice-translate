/**
 * auth.ts — Autenticación (REST /auth/*) y badge de usuario en la portada.
 */
import { $, $opt, app, escapeHtml } from "./state";
import { show } from "./nav";
import { connectWs } from "./ws";
import { toast } from "./ui";
import { t } from "./i18n";
import { refreshPushStatus } from "./push";

export function switchAuthTab(tab: string): void {
  const tabs = $opt("authTabs");
  if (tabs) tabs.dataset.active = tab;
  document.querySelectorAll<HTMLElement>(".auth-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const loginPane = $("authLoginPane");
  const regPane = $("authRegisterPane");
  if (tab === "login") {
    loginPane.style.display = "block";
    regPane.style.display = "none";
  } else {
    loginPane.style.display = "none";
    regPane.style.display = "block";
  }
}

export async function doRegister(): Promise<void> {
  const email = $<HTMLInputElement>("regEmail").value.trim();
  const nickname = $<HTMLInputElement>("regNick").value.trim();
  const pwd = $<HTMLInputElement>("regPwd").value;
  if (!email || !pwd) {
    toast(t("toast-email-password-required"));
    return;
  }
  if (pwd.length < 6) {
    toast(t("toast-min-6-chars"));
    return;
  }
  try {
    const r = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pwd, nickname }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      toast(e.detail || t("toast-register-error"));
      return;
    }
    const data = await r.json();
    app.currentUser = data.user;
    toast(t("toast-register-welcome") + (data.user.nickname || data.user.email));
    onAuthSuccess();
  } catch {
    toast(t("toast-network-error"));
  }
}

export async function doLogin(): Promise<void> {
  const email = $<HTMLInputElement>("loginEmail").value.trim();
  const pwd = $<HTMLInputElement>("loginPwd").value;
  if (!email || !pwd) {
    toast(t("toast-email-password-required"));
    return;
  }
  try {
    const r = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pwd }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      toast(e.detail || t("toast-login-error"));
      return;
    }
    const data = await r.json();
    app.currentUser = data.user;
    onAuthSuccess();
  } catch {
    toast(t("toast-network-error"));
  }
}

export async function doLogout(): Promise<void> {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch {}
  app.currentUser = null;
  app.currentRecordingId = null;
  if (app.ws) {
    try {
      app.ws.close?.();
    } catch {}
    app.ws = null;
  }
  show("viewAuth");
  toast(t("toast-logged-out"));
}

export function onAuthSuccess(): void {
  show("viewLanding");
  renderUserBadge();
  connectWs();
}

export function renderUserBadge(): void {
  const subEl = document.querySelector<HTMLElement>("#viewLanding .hero .sub");
  if (!app.currentUser) return;
  const settingsEmail = $opt("settingsUserEmail");
  if (settingsEmail) settingsEmail.textContent = app.currentUser.email;
  if (!subEl) return;
  const trial = app.currentUser.trial;
  let trialPill = "";
  if (trial && trial.limit) {
    const remain = Math.max(0, trial.limit - trial.used);
    const cls = remain === 0 ? "trial-pill empty" : "trial-pill";
    trialPill = `<span class="${cls}" title="${t("user-badge-trial-title")}">${t("user-badge-trial")}${remain}/${trial.limit}</span>`;
  }
  subEl.innerHTML = `${t("user-badge-hello")}<b>${escapeHtml(app.currentUser.nickname)}</b>${trialPill} · <a onclick="doLogout()" style="color:var(--orange);cursor:pointer;text-decoration:underline">${t("user-badge-logout")}</a>`;
}

export async function refreshTrialStatus(): Promise<void> {
  if (app.demo) return;
  try {
    const r = await fetch("/auth/me");
    if (r.ok) {
      app.currentUser = await r.json();
      renderUserBadge();
      refreshPushStatus();
    }
  } catch {}
}
