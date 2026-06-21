# Traductor en Vivo

Traductor de voz en tiempo real para hablar con amigos (p. ej. de HelloTalk):
**traducción individual** con subtítulos en vivo estilo *Apple Live Captions* y
**salas grupales** donde cada quien habla en su idioma y lo lee en el suyo.

Frontend reescrito en **TypeScript + Vite**, modular y tipado. El contrato con el
backend (WebSocket `/ws`, auth, grabaciones, exportación) se mantiene intacto.

---

## Requisitos

- Node.js 18+

## Desarrollo

```bash
npm install
npm run dev
```

- Sin backend, la app arranca en **modo demo** (amigos simulados, subtítulos en
  vivo, onda animada). El modo demo SOLO existe en desarrollo.
- Con tu backend corriendo, enruta las llamadas con la variable `BACKEND`:

```bash
BACKEND=http://localhost:8000 npm run dev
```

Esto hace proxy de `/auth`, `/ws`, `/recordings` y `/export` hacia tu servidor.

## Producción

```bash
npm run build      # typecheck + vite build → carpeta dist/
```

Sirve la carpeta `dist/` desde tu backend (FastAPI, etc.) junto a la API. En el
build de producción el modo demo queda **desactivado**: sin sesión se muestra la
pantalla de login.

## Vista previa sin compilar

`preview-no-build.html` transpila los módulos TypeScript en el navegador (Babel)
y los ejecuta sin build. Útil para ver la app al instante servida por http:

```bash
python -m http.server 5500   # luego abre http://localhost:5500/preview-no-build.html
```

> No uses `preview-no-build.html` en producción — es solo una comodidad de
> desarrollo. Para producir un binario optimizado usa `npm run build`.

---

## Arquitectura

```
index.html            Markup + carga de fuentes y librería VAD (CDN)
src/
  main.ts             Entrada: importa estilos, expone handlers, arranca
  boot.ts             Inicialización: selects, sesión, demo vs login
  protocol.ts         Tipos del contrato cliente ⇆ servidor (sin runtime)
  languages.ts        Idiomas soportados
  state.ts            Estado compartido (app, config) + utilidades DOM
  ws.ts               WebSocket: conexión, envío y enrutado de mensajes
  audio.ts            Micrófono, PCM, VAD, onda (FFT) y reproducción TTS
  solo.ts             Subtítulos en vivo (modo individual)
  room.ts             Flujo de turnos y miembros (modo sala)
  langbar.ts          Selector de idiomas + sincronización de config
  panels.ts           Bottom sheets (ajustes, crear/unirse a sala)
  recordings.ts       Historial de grabaciones (REST)
  auth.ts             Login / registro / sesión
  nav.ts              Conmutación de vistas y navegación
  ui.ts               Toasts, banner, modal de prueba, splash
  demo.ts             Modo demo (solo desarrollo)
  styles.css          Estilos (tokens de diseño + componentes)
  globals.d.ts        Tipos de librerías CDN y de los handlers en window
```

### Nota sobre los manejadores `onclick`

El markup usa manejadores inline (`onclick="toggleMic()"`). `main.ts` expone esas
funciones en `window` con tipos declarados en `globals.d.ts`, conservando el
markup original mientras toda la lógica vive en módulos TypeScript tipados.

## Contrato con el backend (sin cambios)

- `GET  /auth/me` · `POST /auth/login` · `POST /auth/register` · `POST /auth/logout`
- `WS   /ws` — comandos del cliente `{ command: ... }`:
  `start`, `stop`, `audio`, `update_config`, `record_entry`,
  `create_room`, `join_room`, `leave_room`, `speak_start`, `speak_stop`.
- `GET  /recordings` · `GET /recordings/:id.md` · `DELETE /recordings/:id`
- `GET  /export?code=...`

Los tipos de todos los mensajes están en `src/protocol.ts`.
