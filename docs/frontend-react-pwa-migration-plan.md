# Frontend React/Vite/PWA Migration Plan

Date: 2026-06-20

## Objective

Refactor only the main user app currently in `static/index.html` into a maintainable React + TypeScript + Vite frontend, using `Traductor-A-Claro.html` as the visual reference. Do not migrate `static/admin.html` in this phase.

The final app should keep the current backend contract intact:

- REST auth: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
- REST data: `/langs`, `/recordings`, `/recordings/{id}.md`, `/rooms`, `/export`
- WebSocket: `/ws`
- Static admin page: `/admin/stats` and `static/admin.html` stay as-is

The app should also become a PWA installable on iOS and Android, with a path to Web Push notifications.

## Non-Goals

- Do not refactor `static/admin.html`.
- Do not redesign the backend translation pipeline.
- Do not change WebSocket message shapes unless a backward-compatible adapter is added.
- Do not remove the existing single-file `static/index.html` until the React build is serving correctly.
- Do not add native iOS/Android wrappers in this phase. This is a browser PWA, not Capacitor/React Native.

## Reference

- Visual target: `/private/tmp/hellotalks-translator-review/Traductor-A-Claro.html`
- Current deployed entrypoint: `voice-translate/static/index.html`
- Backend static route: `server.py` currently returns `FileResponse("static/index.html")`
- Admin route must remain unchanged: `server.py` returns `FileResponse("static/admin.html")`

## Current State

- `static/index.html` is a large vanilla JS SPA with inline CSS and inline logic.
- `static/index.html` has already been replaced by the A Claro prototype.
- The backend is FastAPI and serves `/` directly from `static/index.html`.
- There is no Node/Vite frontend toolchain yet.
- SQLite schema is created in `db.init()` via `CREATE TABLE IF NOT EXISTS`.
- Auth is cookie-based with `HttpOnly` session cookie `rt_session`.

## Architecture Target

Create a new frontend app under a domain-oriented structure. The goal is not just to split files, but to keep runtime-heavy concerns like microphone capture, WebSocket state, room state, and incremental translation out of visual components.

```text
voice-translate/frontend/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  public/
    manifest.webmanifest
    icons/
    sw.js
  src/
    main.tsx
    app/
      App.tsx
      providers.tsx
      routes.tsx
    pages/
      AuthPage.tsx
      HomePage.tsx
      SoloTranslatePage.tsx
      RoomPage.tsx
    shared/
      api/
        client.ts
        errors.ts
      components/
        Button.tsx
        Modal.tsx
        Toast.tsx
      hooks/
        useLocalStorage.ts
        useStableCallback.ts
      lib/
        format.ts
        clipboard.ts
      styles/
        base.css
        tokens.css
      types/
        api.ts
        websocket.ts
    features/
      auth/
      settings/
      history/
      pwa/
      push/
    domains/
      audio/
        audioCapture.ts
        pcm.ts
        useMicrophoneCapture.ts
        useWaveformAnalyser.ts
      translation/
        translationSession.ts
        useTranslationSession.ts
      rooms/
        roomProtocol.ts
        roomState.ts
        useRoomSession.ts
      recording/
        recordingsApi.ts
        recordingTypes.ts
      websocket/
        websocketClient.ts
        websocketProtocol.ts
      languages/
        languagesApi.ts
        languageTypes.ts
```

### Boundary Rules

- `pages/` composes screens only. It should not contain raw `fetch`, `WebSocket`, `AudioContext`, `MediaStream`, or service worker code.
- `shared/` contains generic UI, hooks, formatting, API primitives, and styles that do not know app-specific business rules.
- `features/` contains product capabilities that are mostly UI plus orchestration, such as auth, settings, history, PWA install prompts, and push opt-in.
- `domains/` contains business and runtime logic with stable interfaces: audio capture, translation session, rooms, recordings, WebSocket protocol, and language metadata.
- Visual components receive state and callbacks as props or hooks. They must not directly own backend protocols.
- WebSocket message shapes should be defined once in `shared/types/websocket.ts` or `domains/websocket/websocketProtocol.ts`.
- Timer, animation frame, stream, and socket cleanup must live in domain hooks or clients, not page components.
- New features should prefer adding a small domain/feature module over expanding a large page file.

Build output:

```text
voice-translate/static/app/
```

FastAPI should serve:

- `/` -> `static/app/index.html` when the React build exists
- `/assets/*` -> Vite assets
- `/admin/stats` -> existing `static/admin.html`

During migration, keep `static/index.html` as fallback until the new app is complete.

## Phase 1: Frontend Scaffold

- [x] Add `frontend/package.json` with Vite, React, TypeScript, ESLint, and basic scripts.
- [x] Add `frontend/vite.config.ts`.
- [x] Configure Vite build output to `../static/app`.
- [x] Add TypeScript config files.
- [x] Add `src/main.tsx`, `src/app/App.tsx`, `src/app/providers.tsx`, and base CSS.
- [x] Create the folder boundaries: `app/`, `pages/`, `shared/`, `features/`, and `domains/`.
- [x] Port the A Claro design tokens into `src/shared/styles/tokens.css`.
- [x] Add shared primitives for the first screens:
  - [x] `Button`
  - [x] `Modal`
  - [x] `Toast`
- [x] Add a temporary landing screen that matches A visually.
- [x] Verification:
  - [x] `npm install` or chosen package manager install succeeds.
  - [x] `npm run build` creates `static/app/index.html`.
  - [x] The generated app opens locally without backend errors.

Exit criteria: React/Vite app builds and renders the A-style shell without changing backend behavior.

## Phase 2: API and Auth Layer

- [x] Define shared TypeScript types for `User`, `TrialStatus`, `Recording`, `Room`, `LangMap`.
- [x] Create `src/shared/api/client.ts` with typed fetch helpers.
- [x] Create `src/shared/types/api.ts` for REST response/request types.
- [x] Implement cookie-based auth flow using current endpoints.
- [x] Place auth orchestration under `src/features/auth/`.
- [x] Build auth screens:
  - [x] login
  - [x] register
  - [x] logout
  - [x] trial badge
- [x] Preserve current `/auth/me` startup behavior.
- [x] Handle 401 and network failure explicitly.
- [x] Verification:
  - [x] Register works against FastAPI.
  - [x] Login works against FastAPI.
  - [x] Refresh keeps session through cookie.
  - [x] Logout clears UI and session.

Exit criteria: users can authenticate from React with the same backend cookies as the vanilla app.

## Phase 3: WebSocket and Audio Runtime

- [x] Extract WebSocket client into `src/domains/websocket/websocketClient.ts`.
- [x] Define message unions in `src/domains/websocket/websocketProtocol.ts`.
- [ ] Preserve all existing client-to-server commands:
  - [x] `start`
  - [x] `audio`
  - [x] `stop`
  - [x] `update_config`
  - [x] `create_room`
  - [x] `join_room`
  - [x] `leave_room`
  - [x] `speak_start`
  - [x] `speak_stop`
- [x] Preserve all existing server message types in the central protocol union.
- [x] Implement solo server message handling in `useTranslationSession`.
- [ ] Implement room server message handling in `useRoomSession` during Phase 4.
- [x] Extract mic capture into `src/domains/audio/useMicrophoneCapture.ts`.
- [x] Extract PCM encoding into `src/domains/audio/pcm.ts`.
- [ ] Port Web Audio FFT wave visualization into `src/domains/audio/useWaveformAnalyser.ts`.
- [ ] Port VAD integration into the audio domain without changing behavior.
- [x] Create `src/domains/translation/useTranslationSession.ts` as the public hook used by `SoloTranslatePage`.
- [ ] Implement clear cleanup on component unmount:
  - [x] stop tracks
  - [x] close WebSocket
  - [ ] cancel animation frames
  - [ ] clear timers
- [ ] Verification:
  - [x] Domain tests cover WebSocket command shapes, PCM encoding, and translation reducer state.
  - [x] Frontend build/typecheck/lint pass.
  - [ ] Solo recording starts and stops against a live backend.
  - [ ] Transcript and translation messages render against a live backend.
  - [ ] Audio playback still works when TTS is enabled against a live backend.
  - [ ] No duplicate WebSocket connections after navigation in browser verification.

Exit criteria: solo translation works through React with the current `/ws` protocol.

## Phase 4: Room Experience

- [ ] Create `src/domains/rooms/roomProtocol.ts` for room-specific WebSocket commands/events.
- [ ] Create `src/domains/rooms/roomState.ts` for member/turn state transitions.
- [ ] Create `src/domains/rooms/useRoomSession.ts` as the public hook used by `RoomPage`.
- [ ] Port create-room modal.
- [ ] Port join-room modal.
- [ ] Port room header, room code copy, members strip, and invite action.
- [ ] Preserve room name truncation from A:
  - [ ] `white-space: nowrap`
  - [ ] `overflow: hidden`
  - [ ] `text-overflow: ellipsis`
  - [ ] max width appropriate for mobile
- [ ] Port room transcript rendering with incremental updates.
- [ ] Port speaking state indicators.
- [ ] Port room export link.
- [ ] Preserve URL deep link behavior: `/?room=CODE`.
- [ ] Verification:
  - [ ] Create room works.
  - [ ] Join room works.
  - [ ] Member join/leave updates UI.
  - [ ] Room translations render per turn.
  - [ ] Export still downloads Markdown.

Exit criteria: room flows match or exceed the A prototype behavior.

## Phase 5: History and Settings

- [ ] Place history UI under `src/features/history/`.
- [ ] Place settings UI under `src/features/settings/`.
- [ ] Place recording API/types under `src/domains/recording/`.
- [ ] Place languages API/types under `src/domains/languages/`.
- [ ] Port settings panel:
  - [ ] ASR language
  - [ ] target language
  - [ ] translate toggle
  - [ ] TTS toggle
  - [ ] engine selector if currently exposed
- [ ] Port language picker/search.
- [ ] Port recordings history panel.
- [ ] Port recording download.
- [ ] Port recording delete.
- [ ] Persist user preferences in local storage.
- [ ] Verification:
  - [ ] Settings update UI and push config to active websocket.
  - [ ] History list loads from `/recordings`.
  - [ ] Download and delete work.

Exit criteria: feature parity with the single-file UI outside admin.

## Phase 6: FastAPI Serving Integration

- [ ] Keep `static/admin.html` untouched.
- [ ] Add static mount for Vite assets, likely `StaticFiles(directory="static/app/assets")`.
- [ ] Change `/` to serve `static/app/index.html` if it exists.
- [ ] Keep fallback to `static/index.html` during rollout.
- [ ] Add SPA fallback only for frontend routes if React Router is introduced.
- [ ] Update Dockerfile to build frontend before running FastAPI, or document a two-step build.
- [ ] Update `.dockerignore` if needed.
- [ ] Verification:
  - [ ] `python server.py` serves the React app at `/`.
  - [ ] `/admin/stats` still serves existing admin page.
  - [ ] `/auth/me`, `/ws`, `/recordings`, `/rooms`, `/export` are not shadowed by static routing.

Exit criteria: production server can serve React build and existing admin page safely.

## Phase 7: PWA Installability

- [ ] Add `public/manifest.webmanifest`.
- [ ] Add app name, short name, theme color, background color, `display: standalone`, and `id`.
- [ ] Add required icons:
  - [ ] 192x192
  - [ ] 512x512
  - [ ] maskable icon
  - [ ] Apple touch icon
- [ ] Add mobile meta tags in `frontend/index.html`.
- [ ] Add service worker registration.
- [ ] Add offline shell caching for app assets only.
- [ ] Add PWA install/help UI:
  - [ ] Android install prompt
  - [ ] iOS "Add to Home Screen" instructions
- [ ] Verification:
  - [ ] Lighthouse PWA checks pass for installability.
  - [ ] App opens standalone after install on Android.
  - [ ] App opens standalone after Add to Home Screen on iOS.

Exit criteria: app is installable as a PWA without push notifications yet.

## Phase 8: Web Push Backend

- [ ] Add dependency for Web Push, for example `pywebpush`.
- [ ] Add env vars:
  - [ ] `VAPID_PUBLIC_KEY`
  - [ ] `VAPID_PRIVATE_KEY`
  - [ ] `VAPID_SUBJECT`
- [ ] Add SQLite table:

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- [ ] Add DB helpers:
  - [ ] upsert subscription
  - [ ] delete subscription
  - [ ] list subscriptions by user
  - [ ] prune invalid subscriptions
- [ ] Add authenticated endpoints:
  - [ ] `GET /push/vapid-public-key`
  - [ ] `POST /push/subscribe`
  - [ ] `POST /push/unsubscribe`
  - [ ] `POST /push/test`
- [ ] Send push only to the authenticated user's stored subscriptions.
- [ ] Never log full push endpoints or encryption keys.
- [ ] Verification:
  - [ ] Subscription is stored for logged-in user.
  - [ ] Test notification arrives on Android installed PWA.
  - [ ] Test notification arrives on iOS Home Screen app where supported.
  - [ ] Invalid subscriptions are pruned after send failure.

Exit criteria: users can opt into push and receive a test notification.

## Phase 9: Product Notification Events

Start conservative. Push notifications should be opt-in and user-controlled.

- [ ] Add notification settings UI:
  - [ ] enable/disable push
  - [ ] test notification
  - [ ] room activity toggle
- [ ] Candidate events:
  - [ ] someone joins my active room
  - [ ] room invitation reminder
  - [ ] translation completed while app is backgrounded
- [ ] Avoid noisy defaults:
  - [ ] no notification for every partial transcript
  - [ ] no notification while the app is foregrounded unless explicitly useful
- [ ] Add server-side helper to fan out notifications by user id.
- [ ] Verification:
  - [ ] Foreground app does not spam notifications.
  - [ ] Background/closed installed PWA receives selected events.
  - [ ] User can unsubscribe.

Exit criteria: production notification behavior is useful and not noisy.

## Phase 10: Cleanup and Documentation

- [ ] Remove obsolete inline demo-only code from old `static/index.html` after React is live.
- [ ] Decide whether to archive old `static/index.html` as `static/index.legacy.html`.
- [ ] Update README:
  - [ ] frontend dev commands
  - [ ] backend dev commands
  - [ ] build commands
  - [ ] PWA install notes
  - [ ] push env vars
- [ ] Update screenshots for A Claro React UI.
- [ ] Add a short migration note in `docs/`.
- [ ] Verification:
  - [ ] clean install from README works.
  - [ ] Docker build works if Docker is part of deployment.

Exit criteria: repo no longer depends on undocumented local knowledge to build or run the frontend.

## Suggested Execution Order

1. Phase 1: scaffold and visual shell
2. Phase 2: auth
3. Phase 3: solo WebSocket/audio
4. Phase 4: rooms
5. Phase 5: history/settings
6. Phase 6: FastAPI serving
7. Phase 7: PWA installability
8. Phase 8: Web Push backend
9. Phase 9: product notifications
10. Phase 10: cleanup/docs

PWA installability can start before the full frontend is complete, but Web Push should wait until auth and serving are stable.

## Risk Register

- [ ] A folder split alone does not prevent spaghetti; enforce the boundary rules during review.
- [ ] Microphone permissions can behave differently in installed PWA mode.
- [ ] iOS Web Push requires the app to be added to Home Screen and permission must be requested from a user gesture.
- [ ] Service worker caching can accidentally cache auth-sensitive or websocket-adjacent responses if routes are too broad.
- [ ] WebSocket lifecycle bugs can create duplicate audio streams or duplicate translations.
- [ ] VAD/audio work may depend on assets or WASM/ONNX paths that need explicit Vite handling.
- [ ] Push subscription endpoints are sensitive capability URLs and must not be leaked in logs.
- [ ] Static route changes can break `/admin/stats` if mounted too broadly.

## Verification Matrix

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run build`
- [x] no page component imports raw `WebSocket`, `AudioContext`, `MediaStream`, or direct `fetch`
- [ ] backend starts with `python server.py` or current `./serve.sh`
- [ ] `/` loads React app
- [ ] `/admin/stats` loads existing admin page
- [ ] register/login/logout
- [ ] solo recording
- [ ] room create/join/leave
- [ ] history list/download/delete
- [ ] PWA installability audit
- [ ] push subscription and test notification

## Rollback Strategy

- Keep `static/index.html` available as a fallback until Phase 6 is complete.
- If React build fails in production, serve legacy `static/index.html`.
- Keep backend API and WebSocket message contracts backward-compatible.
- Introduce push endpoints without making them required for app startup.

## Open Decisions

- [ ] Package manager: npm, pnpm, yarn, or bun.
- [ ] React Router: needed only if we want real routes beyond `/`.
- [ ] CSS approach: plain CSS files, CSS modules, Tailwind, or another system.
- [ ] Push provider: direct Web Push via VAPID, Firebase Cloud Messaging, OneSignal, or another service.
- [ ] Notification event policy: which room/translation events are worth notifying.
- [ ] Icon/logo source for PWA assets.
