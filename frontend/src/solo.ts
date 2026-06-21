/**
 * solo.ts — Modo individual: subtítulos en vivo estilo Apple Live Captions.
 *
 * No muestra el texto original ni segmenta visualmente: la traducción fluye de
 * forma continua. En paralelo mantiene fronteras de "turno" (1.5 s de silencio)
 * para reportar cada turno al servidor y persistirlo (`record_entry`).
 */
import { $, $opt } from "./state";
import { config } from "./state";
import { app } from "./state";
import type { SoloTranscriptInput, SoloTranslationInput } from "./protocol";
import { send } from "./ws";
import { toast } from "./ui";

const TURN_GAP_MS = 1500;

interface SoloTurn {
  src: string;
  tgt: string;
  lang: string;
  lastTime: number;
  complete?: boolean;
}

let _soloTurn: SoloTurn | null = null;
let _soloDoneTurns: SoloTurn[] = [];
let _soloRotateTimer: number | null = null;

function newSoloTurn(): SoloTurn {
  return { src: "", tgt: "", lang: "", lastTime: Date.now() };
}

function scheduleSoloRotate(): void {
  if (_soloRotateTimer) clearTimeout(_soloRotateTimer);
  _soloRotateTimer = window.setTimeout(flushSoloTurn, TURN_GAP_MS);
}

function flushSoloTurn(): void {
  _soloRotateTimer = null;
  if (!_soloTurn) return;
  if (_soloTurn.src || _soloTurn.tgt) {
    send({
      command: "record_entry",
      src: _soloTurn.src,
      tgt: _soloTurn.tgt,
      lang: _soloTurn.lang,
    });
    _soloDoneTurns.push(_soloTurn);
  }
  _soloTurn = null;
  renderSubtitles();
}

export function handleSoloTranscript(m: SoloTranscriptInput): void {
  if (m.final) {
    if (_soloTurn && (_soloTurn.src || _soloTurn.tgt)) flushSoloTurn();
    _soloTurn = newSoloTurn();
    _soloTurn.src = m.text;
    _soloTurn.complete = true; // espera al translation final para el tgt
    if (m.lang) _soloTurn.lang = m.lang;
    _soloTurn.lastTime = Date.now();
    scheduleSoloRotate();
    renderSubtitles();
    return;
  }
  if (_soloTurn && _soloTurn.complete) flushSoloTurn();
  if (!_soloTurn) _soloTurn = newSoloTurn();
  if (m.incremental) _soloTurn.src += m.text;
  else _soloTurn.src = m.text;
  if (m.lang) _soloTurn.lang = m.lang;
  _soloTurn.lastTime = Date.now();
  scheduleSoloRotate();
  if (!_soloTurn.tgt) renderSubtitles();
}

export function handleSoloTranslation(m: SoloTranslationInput): void {
  if (!config.translate) return;
  if (m.final) {
    if (!_soloTurn) _soloTurn = newSoloTurn();
    _soloTurn.tgt = m.text;
    _soloTurn.lastTime = Date.now();
    scheduleSoloRotate();
    renderSubtitles();
    return;
  }
  if (_soloTurn && _soloTurn.complete) flushSoloTurn();
  if (!_soloTurn) _soloTurn = newSoloTurn();
  if (m.incremental) _soloTurn.tgt += m.text;
  else _soloTurn.tgt = m.text;
  _soloTurn.lastTime = Date.now();
  scheduleSoloRotate();
  renderSubtitles();
}

/* Estado de render de subtítulos — render incremental por carácter para evitar
   el parpadeo de reconstruir innerHTML completo en cada frame. */
const _capState = {
  renderedDoneCount: 0,
  currentText: "",
  keptDoneEls: [] as HTMLElement[],
};

function renderSubtitles(): void {
  const empty = $opt("soloEmpty");
  if (empty) empty.style.display = "none";
  const el = $("subtitleText");
  el.style.display = "flex";

  // 1. Cada turno completado "degrada" el .cap-current actual a .cap-old.
  const newDoneCount = _soloDoneTurns.length;
  if (newDoneCount > _capState.renderedDoneCount) {
    const cur = el.querySelector<HTMLElement>(".cap-current");
    if (cur) {
      cur.classList.remove("cap-current", "cap-placeholder");
      cur.classList.add("cap-old");
      cur.style.animationDelay = "";
      _capState.keptDoneEls.push(cur);
    }
    _capState.currentText = "";
    _capState.renderedDoneCount = newDoneCount;
  }

  // 2. Texto del turno actual
  let currentText = "";
  let isPlaceholder = false;
  if (_soloTurn) {
    if (_soloTurn.tgt) {
      currentText = _soloTurn.tgt;
    } else if (_soloTurn.src) {
      currentText = _soloTurn.src;
      isPlaceholder = true;
    }
  }

  let cur = el.querySelector<HTMLElement>(".cap-current");
  if (currentText) {
    if (!cur) {
      cur = document.createElement("div");
      cur.className = "cap-current";
      el.appendChild(cur);
      _capState.currentText = "";
    }
    cur.classList.toggle("cap-placeholder", isPlaceholder);

    const old = _capState.currentText;
    if (currentText === old) {
      // sin cambios
    } else if (currentText.startsWith(old)) {
      const added = Array.from(currentText.slice(old.length));
      added.forEach((ch) => {
        const span = document.createElement("span");
        span.className = "ch";
        span.textContent = ch;
        cur!.appendChild(span);
      });
    } else {
      cur.innerHTML = "";
      Array.from(currentText).forEach((ch, i) => {
        const span = document.createElement("span");
        span.className = "ch";
        span.textContent = ch;
        span.style.animationDelay = i * 22 + "ms";
        cur!.appendChild(span);
      });
    }
    _capState.currentText = currentText;
  } else if (cur) {
    cur.remove();
    _capState.currentText = "";
  }

  // 3. Cursor parpadeante al final mientras se graba
  let cursor = el.querySelector<HTMLElement>(".subtitle-cursor");
  if (app.recording) {
    if (!cursor) {
      cursor = document.createElement("span");
      cursor.className = "subtitle-cursor";
    }
    el.appendChild(cursor);
  } else if (cursor) {
    cursor.remove();
  }

  const c = $("soloTranscript");
  c.scrollTop = c.scrollHeight;
}

/** Cierra el turno actual sin borrar el historial de subtítulos. */
export function resetSoloBubbles(): void {
  if (_soloRotateTimer) {
    clearTimeout(_soloRotateTimer);
    _soloRotateTimer = null;
  }
  flushSoloTurn();
}

export function clearSoloHistory(): void {
  if (_soloRotateTimer) {
    clearTimeout(_soloRotateTimer);
    _soloRotateTimer = null;
  }
  _soloTurn = null;
  _soloDoneTurns = [];
  _capState.renderedDoneCount = 0;
  _capState.currentText = "";
  _capState.keptDoneEls = [];
  $("subtitleText").innerHTML = "";
  $("subtitleText").style.display = "none";
  $("soloEmpty").style.display = "flex";
}

export function downloadCurrent(): void {
  if (app.demo) {
    toast("Descarga disponible al desplegar tu servidor");
    return;
  }
  if (!app.currentRecordingId) {
    toast("No hay grabaciones");
    return;
  }
  window.open("/recordings/" + app.currentRecordingId + ".md", "_blank");
}
