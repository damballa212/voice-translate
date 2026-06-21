/// <reference types="vite/client" />

/**
 * globals.d.ts — Tipos para librerías cargadas por <script> (CDN) y para los
 * manejadores que el markup invoca con `onclick="..."` (deben vivir en window).
 */

interface MicVADOptions {
  baseAssetPath?: string;
  onnxWASMBasePath?: string;
  onFrameProcessed?: (probs: { isSpeech: number }) => void;
}
interface MicVADInstance {
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy?(): void;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    vad?: {
      MicVAD: { new: (opts: MicVADOptions) => Promise<MicVADInstance> };
    };

    /** Arranque del modo demo (solo en build de desarrollo). */
    __startDemo?: () => void;

    /* Manejadores expuestos para los `onclick`/`oninput` del HTML */
    switchAuthTab: (tab: string) => void;
    doLogin: () => void;
    doRegister: () => void;
    doLogout: () => void;
    enterSolo: () => void;
    openCreateRoom: () => void;
    openJoinRoom: () => void;
    doCreateRoom: () => void;
    doJoinRoom: () => void;
    backToLanding: () => void;
    leaveRoom: () => void;
    openSettings: () => void;
    closeOverlay: () => void;
    openLangPicker: (which: "src" | "tgt") => void;
    renderLangList: () => void;
    selectLang: (code: string) => void;
    swapLangs: () => void;
    pushConfig: () => void;
    toggleMic: () => void;
    downloadCurrent: () => void;
    openHistory: () => void;
    deleteRecording: (id: string) => void;
    copyRoomCode: () => void;
    copyTranscript: () => void;
    exportRoom: () => void;
    closeTrialModal: () => void;
    toast: (msg: string) => void;
  }
}

export {};
