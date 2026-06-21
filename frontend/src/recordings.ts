/**
 * recordings.ts — Historial de grabaciones (REST /recordings).
 */
import { $, app } from "./state";
import { showPanel } from "./panels";
import { toast } from "./ui";
import { demoOpenHistory } from "./demo";

interface RecordingItem {
  id: string;
  kind: string;
  name?: string;
  count: number;
  created_at: number; // epoch segundos
}

export async function openHistory(): Promise<void> {
  if (app.demo) {
    demoOpenHistory();
    return;
  }
  showPanel("panelHistory");
  const list = $("historyList");
  const skeletonHTML = Array(4)
    .fill(0)
    .map(
      () => `<div class="record-skeleton">
        <div class="sk-icon"></div>
        <div class="sk-rows">
          <div class="sk-bar sk-title"></div>
          <div class="sk-bar sk-meta"></div>
        </div>
      </div>`,
    )
    .join("");
  list.innerHTML = skeletonHTML;
  try {
    const r = await fetch("/recordings");
    const items = (await r.json()) as RecordingItem[];
    if (!items.length) {
      list.innerHTML = '<div class="record-empty">No hay grabaciones</div>';
      return;
    }
    list.innerHTML = items
      .map((it) => {
        const d = new Date(it.created_at * 1000);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const icon = it.kind === "room" ? "👥" : "🎙";
        const name = (it.name || it.kind).replace(/</g, "&lt;");
        return `<div class="record-item">
        <div class="record-info">
          <div class="record-name">${icon} ${name}</div>
          <div class="record-meta">${dateStr} · ${it.count} entradas</div>
        </div>
        <a class="record-dl" href="/recordings/${it.id}.md" download title="Descargar">↓</a>
        <button class="record-del" onclick="deleteRecording('${it.id}')" title="Eliminar">×</button>
      </div>`;
      })
      .join("");
  } catch {
    list.innerHTML = '<div class="record-empty">Error al cargar</div>';
  }
}

export async function deleteRecording(id: string): Promise<void> {
  if (!confirm("¿Eliminar esta grabación?")) return;
  try {
    await fetch("/recordings/" + id, { method: "DELETE" });
    openHistory();
  } catch {
    toast("Error al eliminar");
  }
}
