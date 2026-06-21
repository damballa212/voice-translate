/**
 * onboarding.ts — Pantalla de bienvenida para configurar el idioma nativo.
 * También maneja el picker de idioma nativo en Ajustes.
 */
import { $, $opt, app } from "./state";
import { show } from "./nav";
import { toast } from "./ui";
import { COMMON_LANGS, langById } from "./languages";
import { t } from "./i18n";

let _selectedNativeLang: string = "";

export function renderOnboardingLangList(): void {
  const container = $opt("onboardingLangList");
  if (!container) return;
  const q = ($opt<HTMLInputElement>("onboardingSearch")?.value || "").trim().toLowerCase();
  const items = COMMON_LANGS.filter((l) => {
    if (l.id === "auto") return false;
    if (!q) return true;
    return (
      l.label.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q) ||
      (l.alias || "").toLowerCase().includes(q)
    );
  });
  container.innerHTML = items.map((l) => {
    const sel = l.id === _selectedNativeLang;
    return `<div onclick="selectOnboardingLang('${l.id}')" style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);cursor:pointer;${sel ? "background:var(--accent-soft);" : ""}">
      <span style="font-size:24px">${l.flag}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:${sel ? 700 : 500};font-size:15px;color:var(--ink)">${l.label}</div>
      </div>
      <span style="font-family:var(--mono);font-size:10px;color:var(--dim);text-transform:uppercase">${l.id}</span>
      ${sel ? '<span style="color:var(--orange);font-weight:700;font-size:18px">✓</span>' : ""}
    </div>`;
  }).join("");
}

export function selectOnboardingLang(id: string): void {
  _selectedNativeLang = id;
  renderOnboardingLangList();
  const btn = $opt<HTMLButtonElement>("onboardingContinueBtn");
  if (btn) btn.disabled = false;
  const desc = $opt("settingsNativeLangDesc");
  if (desc) {
    const lang = langById(id);
    if (lang) desc.textContent = `${lang.flag} ${lang.label}`;
  }
}

export async function doSaveNativeLang(): Promise<void> {
  if (!_selectedNativeLang) {
    toast(t("onboarding-select-prompt"));
    return;
  }
  try {
    const r = await fetch("/auth/native-lang", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ native_lang: _selectedNativeLang }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      toast(e.detail || t("toast-network-error"));
      return;
    }
    const updated = await r.json();
    app.currentUser = updated;
    show("viewLanding");
    toast(t("onboarding-saved-toast"));
  } catch {
    toast(t("toast-network-error"));
  }
}

export function openNativeLangPicker(): void {
  _selectedNativeLang = app.currentUser?.native_lang || "";
  renderOnboardingLangList();
  const btn = $opt<HTMLButtonElement>("onboardingContinueBtn");
  if (btn) btn.disabled = !_selectedNativeLang;
  show("viewOnboarding");
}

export function initOnboarding(): void {
  _selectedNativeLang = app.currentUser?.native_lang || "";
  renderOnboardingLangList();
  const btn = $opt<HTMLButtonElement>("onboardingContinueBtn");
  if (btn) btn.disabled = !_selectedNativeLang;
  const desc = $opt("settingsNativeLangDesc");
  if (desc && _selectedNativeLang) {
    const lang = langById(_selectedNativeLang);
    if (lang) desc.textContent = `${lang.flag} ${lang.label}`;
  }
}
