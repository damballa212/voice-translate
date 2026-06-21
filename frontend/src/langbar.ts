/**
 * langbar.ts — Selector de idiomas (origen/destino), barra superior y
 * sincronización de configuración con el servidor.
 */
import { $, $opt, config } from "./state";
import { COMMON_LANGS, langById } from "./languages";
import { send } from "./ws";
import { showPanel, closeOverlay } from "./panels";
import { t } from "./i18n";

let _langPickerWhich: "src" | "tgt" | null = null;

export function openLangPicker(which: "src" | "tgt"): void {
  _langPickerWhich = which;
  $("langPickerTitle").textContent =
    which === "src" ? t("langbar-picker-src") : t("langbar-picker-tgt");
  $<HTMLInputElement>("langSearchInput").value = "";
  renderLangList();
  showPanel("panelLang");
}

export function renderLangList(): void {
  const q = ($<HTMLInputElement>("langSearchInput").value || "")
    .trim()
    .toLowerCase();
  const which = _langPickerWhich;
  const current = which === "src" ? config.lang : config.target;

  const matches = (l: (typeof COMMON_LANGS)[number]) => {
    if (which === "tgt" && l.id === "auto") return false;
    if (which === "tgt" && config.engine === "openai" && !l.openai) return false;
    return true;
  };

  const items = COMMON_LANGS.filter((l) => {
    if (!matches(l)) return false;
    if (!q) return true;
    return (
      l.label.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q) ||
      (l.alias || "").toLowerCase().includes(q)
    );
  });

  const totalForEngine = COMMON_LANGS.filter(matches).length;
  $("langPickerTitle").innerHTML =
    (which === "src" ? t("langbar-picker-src") : t("langbar-picker-tgt")) +
    ` <span style="font-family:var(--mono);font-size:11px;color:var(--dim);font-weight:400">⚡ OpenAI · ${totalForEngine}</span>`;

  const html = items
    .map((l) => {
      const isCur = l.id === current;
      return `<div onclick="selectLang('${l.id}')"
      style="display:flex;align-items:center;gap:12px;padding:12px 8px;border-bottom:1px solid var(--line);cursor:pointer;${isCur ? "background:var(--paper-2);" : ""}">
      <span style="font-size:22px">${l.flag}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:${isCur ? 700 : 500};font-size:14px;color:var(--ink)">${l.label}</div>
      </div>
      <span style="font-family:var(--mono);font-size:10px;color:var(--dim);text-transform:uppercase">${l.id}</span>
      ${isCur ? '<span style="color:var(--orange);font-weight:700">✓</span>' : ""}
    </div>`;
    })
    .join("");

  $("langList").innerHTML =
    html ||
    `<div style="text-align:center;padding:24px;color:var(--dim)">${t("langbar-no-match")}</div>`;
}

export function selectLang(code: string): void {
  if (_langPickerWhich === "src") config.lang = code;
  else config.target = code;
  updateLangDisplay();
  pushConfig();
  closeOverlay();
}

export function swapLangs(): void {
  const tmp = config.lang;
  config.lang = config.target === "ru" ? "en" : config.target;
  config.target = tmp === "auto" ? "ru" : tmp;
  updateLangDisplay();
  pushConfig();
}

export function updateLangDisplay(): void {
  const srcL = langById(config.lang);
  const tgtL = langById(config.target);
  const sl = $opt("srcLabel");
  if (sl) sl.textContent = srcL?.label || config.lang;
  const tl = $opt("tgtLabel");
  if (tl) tl.textContent = tgtL?.label || config.target;
  const sf = $opt("srcFlag");
  if (sf) sf.textContent = srcL?.flag || "🌐";
  const tf = $opt("tgtFlag");
  if (tf) tf.textContent = tgtL?.flag || "🌐";
  const sa = $opt<HTMLSelectElement>("setAsrLang");
  if (sa) sa.value = config.lang;
  const st = $opt<HTMLSelectElement>("setTargetLang");
  if (st) st.value = config.target;
}

/** Envía la configuración actual al servidor (no lee del DOM salvo toggles). */
export function pushConfig(): void {
  const tt = $opt("toggleTranslate");
  const tts = $opt("toggleTts");
  if (tt) config.translate = tt.classList.contains("on");
  if (tts) config.tts = tts.classList.contains("on");
  send({ command: "update_config", ...config });
}
