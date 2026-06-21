/**
 * push.ts — PWA service worker + Web Push opt-in.
 */
import { $opt } from "./state";
import { toast } from "./ui";
import { t } from "./i18n";

interface PushConfig {
  enabled: boolean;
  publicKey: string;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function b64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    console.warn("[pwa] service worker failed", e);
  }
}

async function getPushConfig(): Promise<PushConfig | null> {
  try {
    const r = await fetch("/push/config");
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function refreshPushStatus(): Promise<void> {
  const el = $opt("pushStatus");
  const btn = $opt<HTMLButtonElement>("pushEnableBtn");
  if (!el || !btn) return;
  if (!supported()) {
    el.textContent = t("push-status-unsupported");
    btn.disabled = true;
    return;
  }
  const cfg = await getPushConfig();
  if (!cfg?.publicKey) {
    el.textContent = t("push-status-server-disabled");
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  if (Notification.permission === "granted") {
    el.textContent = t("push-status-enabled");
  } else if (Notification.permission === "denied") {
    el.textContent = t("push-status-denied");
    btn.disabled = true;
  } else {
    el.textContent = t("push-status-ready");
  }
}

export async function enablePushNotifications(): Promise<void> {
  if (!supported()) {
    toast(t("push-status-unsupported"));
    return;
  }
  const cfg = await getPushConfig();
  if (!cfg?.publicKey) {
    toast(t("push-status-server-disabled"));
    await refreshPushStatus();
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast(t("push-status-denied"));
    await refreshPushStatus();
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToArrayBuffer(cfg.publicKey),
    });
  }
  const r = await fetch("/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!r.ok) {
    toast(t("push-enable-error"));
    return;
  }
  toast(t("push-enabled-toast"));
  await refreshPushStatus();
}
