/**
 * main.ts — Punto de entrada. Importa los estilos, expone los manejadores que
 * el markup usa con `onclick="..."` en `window` y arranca la app.
 */
import "./styles.css";

import { toast } from "./ui";
import { initSplash } from "./ui";
import {
  show,
  backToLanding,
  enterSolo,
  leaveRoom,
  openHome,
  openSettingsRoot,
  initBottomNav,
} from "./nav";
import {
  switchAuthTab,
  doLogin,
  doRegister,
  doLogout,
} from "./auth";
import {
  openSettings,
  openCreateRoom,
  openJoinRoom,
  doCreateRoom,
  doJoinRoom,
  showPanel,
  closeOverlay,
} from "./panels";
import {
  openLangPicker,
  renderLangList,
  selectLang,
  swapLangs,
  pushConfig,
} from "./langbar";
import { toggleMic } from "./audio";
import { downloadCurrent } from "./solo";
import { openHistory, deleteRecording } from "./recordings";
import { copyRoomCode, copyTranscript, exportRoom } from "./room";
import { closeTrialModal } from "./ui";
import { startDemo } from "./demo";
import { init } from "./boot";
import {
  openMessages,
  renderConversations,
  openNewDm,
  doCreateDm,
  openChat,
  backToMessages,
  sendChatText,
  onChatInputKey,
  toggleChatVoiceNote,
  playDmVoice,
} from "./dm";
import { enablePushNotifications, registerServiceWorker } from "./push";

// Expone los manejadores que el HTML invoca inline.
Object.assign(window, {
  toast,
  show,
  openHome,
  openMessages,
  openSettingsRoot,
  backToLanding,
  enterSolo,
  leaveRoom,
  switchAuthTab,
  doLogin,
  doRegister,
  doLogout,
  openSettings,
  openCreateRoom,
  openJoinRoom,
  doCreateRoom,
  doJoinRoom,
  showPanel,
  closeOverlay,
  openLangPicker,
  renderLangList,
  selectLang,
  swapLangs,
  pushConfig,
  toggleMic,
  downloadCurrent,
  openHistory,
  deleteRecording,
  copyRoomCode,
  copyTranscript,
  exportRoom,
  closeTrialModal,
  renderConversations,
  openNewDm,
  doCreateDm,
  openChat,
  backToMessages,
  sendChatText,
  onChatInputKey,
  toggleChatVoiceNote,
  playDmVoice,
  enablePushNotifications,
  __startDemo: startDemo,
});

initSplash();
initBottomNav();
registerServiceWorker();
init();
