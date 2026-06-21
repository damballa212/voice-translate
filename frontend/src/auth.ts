/**
 * auth.ts — Autenticación (REST /auth/*) y badge de usuario en la portada.
 */
import { $, $opt, app, escapeHtml } from "./state";
import { show } from "./nav";
import { connectWs } from "./ws";
import { toast } from "./ui";

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
    toast("Correo y contraseña son obligatorios");
    return;
  }
  if (pwd.length < 6) {
    toast("Mínimo 6 caracteres");
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
      toast(e.detail || "Error en el registro");
      return;
    }
    const data = await r.json();
    app.currentUser = data.user;
    toast("Registro exitoso, bienvenido " + (data.user.nickname || data.user.email));
    onAuthSuccess();
  } catch {
    toast("Error de red");
  }
}

export async function doLogin(): Promise<void> {
  const email = $<HTMLInputElement>("loginEmail").value.trim();
  const pwd = $<HTMLInputElement>("loginPwd").value;
  if (!email || !pwd) {
    toast("Correo y contraseña son obligatorios");
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
      toast(e.detail || "Error al iniciar sesión");
      return;
    }
    const data = await r.json();
    app.currentUser = data.user;
    onAuthSuccess();
  } catch {
    toast("Error de red");
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
  toast("Sesión cerrada");
}

export function onAuthSuccess(): void {
  show("viewLanding");
  renderUserBadge();
  connectWs();
}

export function renderUserBadge(): void {
  const subEl = document.querySelector<HTMLElement>("#viewLanding .hero .sub");
  if (!subEl || !app.currentUser) return;
  const trial = app.currentUser.trial;
  let trialPill = "";
  if (trial && trial.limit) {
    const remain = Math.max(0, trial.limit - trial.used);
    const cls = remain === 0 ? "trial-pill empty" : "trial-pill";
    trialPill = `<span class="${cls}" title="Usos restantes">Prueba ${remain}/${trial.limit}</span>`;
  }
  subEl.innerHTML = `Hola, <b>${escapeHtml(app.currentUser.nickname)}</b>${trialPill} · <a onclick="doLogout()" style="color:var(--orange);cursor:pointer;text-decoration:underline">Salir</a>`;
}

export async function refreshTrialStatus(): Promise<void> {
  if (app.demo) return;
  try {
    const r = await fetch("/auth/me");
    if (r.ok) {
      app.currentUser = await r.json();
      renderUserBadge();
    }
  } catch {}
}
