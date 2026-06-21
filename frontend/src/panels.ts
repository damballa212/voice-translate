/**
 * panels.ts — Overlay inferior (bottom sheets): ajustes, crear/unirse a sala.
 */
import { $, $opt, config } from "./state";
import { send } from "./ws";
import { toast } from "./ui";

export function showPanel(id: string): void {
  document
    .querySelectorAll<HTMLElement>("#overlay .panel")
    .forEach((p) => (p.style.display = "none"));
  $(id).style.display = "block";
  $("overlay").classList.add("show");
}

export function closeOverlay(): void {
  const ov = $("overlay");
  ov.classList.add("closing");
  setTimeout(() => ov.classList.remove("show", "closing"), 150);
}

export function openSettings(): void {
  showPanel("panelSettings");
}
export function openCreateRoom(): void {
  showPanel("panelCreate");
}
export function openJoinRoom(): void {
  showPanel("panelJoin");
}

export function doCreateRoom(): void {
  const name = $<HTMLInputElement>("createName").value.trim() || "Sala";
  const nick = $<HTMLInputElement>("createNick").value.trim() || "Yo";
  const target = $<HTMLSelectElement>("createTarget").value || "ru";
  config.target = target;
  closeOverlay();
  send({ command: "create_room", room_name: name, name: nick, target });
}

export function doJoinRoom(): void {
  const code = $<HTMLInputElement>("joinCode").value.trim().toUpperCase();
  if (!code) {
    toast("Ingresa el código");
    return;
  }
  const nick = $<HTMLInputElement>("joinNick").value.trim() || "Yo";
  const target = $<HTMLSelectElement>("joinTarget").value || "ru";
  config.target = target;
  closeOverlay();
  send({ command: "join_room", code, name: nick, target });
}
