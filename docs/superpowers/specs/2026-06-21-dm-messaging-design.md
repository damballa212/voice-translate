# DM Messaging Design

Date: 2026-06-21

## Goal

Add a persistent one-to-one messaging section to Voice Translate, inspired by the practical chat flow of apps like HelloTalk and WhatsApp, while preserving the current voice translation and room flows.

The first version uses email-based discovery: a logged-in user starts a DM by entering another registered user's email. The conversation persists in SQLite and remains available after refresh, logout, server restart, or later sessions.

## Non-Goals

- No public user directory in this phase.
- No social feed or HelloTalk-style Moments.
- No group DMs.
- No message deletion UI in the MVP.
- No push notifications in the MVP.
- No native iOS/Android wrapper. The app remains a mobile-first browser/PWA-style app.
- Do not reuse the live translation microphone pipeline for voice notes.

## UX Direction

The app should feel native on mobile:

- On mobile, the app fills the viewport with `100dvh`; it should not appear as a floating desktop phone rectangle.
- Desktop may keep a constrained shell for preview, but mobile is the primary layout.
- Root-level screens use a bottom navbar:
  - `Inicio`
  - `Mensajes`
  - `Ajustes`
- A conversation screen does not show the bottom navbar. It uses:
  - compact chat header
  - back button
  - contact identity
  - scrollable message history
  - fixed composer
- The visual style must reuse the current palette, typography, rounded controls, subtle borders, and purple primary color already present in `frontend/src/styles.css`.

## Screens

### Inicio

The existing landing page becomes the root `Inicio` tab and gains a `Mensajes` entry. It keeps the current translation actions:

- Traduccion individual
- Mensajes
- Crear sala
- Unirse a sala

### Mensajes

The `Mensajes` tab is a real page, not a modal.

It shows:

- page title
- search field for local conversation filtering
- list of conversations
- unread badge
- last message preview
- last activity timestamp
- floating or header action for `Nuevo chat`

`Nuevo chat` asks for an email. If the email belongs to an existing user and is not the current user, the backend creates or returns the existing one-to-one conversation.

### Chat

The chat screen shows a single persistent conversation:

- header with back button and participant name/email
- historical messages loaded from SQLite
- incoming/outgoing bubble styling
- text messages
- voice note bubbles with play control, waveform-style visual, and duration
- fixed bottom composer with text input, microphone button, and send button

The chat screen hides the bottom navbar because the conversation itself is the active task.

## Backend Data Model

Add these SQLite tables in `db.init()` using `CREATE TABLE IF NOT EXISTS`.

```sql
dm_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

dm_members (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at REAL NOT NULL,
  last_read_message_id INTEGER,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
  body TEXT,
  voice_path TEXT,
  voice_mime TEXT,
  voice_duration_ms INTEGER,
  voice_size_bytes INTEGER,
  created_at REAL NOT NULL,
  deleted_at REAL,
  FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_dm_members_user ON dm_members(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation ON dm_messages(conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_updated ON dm_conversations(updated_at DESC);
```

One-to-one uniqueness cannot be represented cleanly with the current minimal SQLite schema unless a deterministic pair key is added. The MVP should enforce uniqueness in Python by checking existing shared conversations before creating a new one.

## REST API

All endpoints require the existing cookie session.

```text
GET  /dm/conversations
POST /dm/conversations
GET  /dm/conversations/{conversation_id}/messages
POST /dm/conversations/{conversation_id}/voice
GET  /dm/voice/{message_id}
```

### `GET /dm/conversations`

Returns conversations for the current user, ordered by `updated_at DESC`.

Each item includes:

- `id`
- `participant`: `id`, `email`, `nickname`
- `last_message`
- `unread_count`
- `updated_at`

### `POST /dm/conversations`

Request:

```json
{ "email": "friend@example.com" }
```

Behavior:

- normalize email with lowercase and trim
- reject current user's own email
- return `404` if the user does not exist
- return existing conversation if both users already share one
- otherwise create conversation and two member rows

### `GET /dm/conversations/{conversation_id}/messages`

Returns messages if and only if the current user is a member.

The MVP can return the latest 100 messages in chronological order. Add cursor pagination later when needed.

### `POST /dm/conversations/{conversation_id}/voice`

Accepts `multipart/form-data`:

- `audio`: file
- `duration_ms`: integer

Server validation:

- current user must be a member
- size limit, initially 10 MB
- allowed MIME types: `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/ogg`
- store under `data/voice-notes/`
- generate non-guessable filename
- insert `dm_messages.kind = 'voice'`
- update conversation `updated_at`
- emit realtime event to online participants

### `GET /dm/voice/{message_id}`

Streams the voice note only if the current user belongs to the message conversation.

## WebSocket Protocol

Keep the existing `/ws` endpoint and add DM commands/events. The WebSocket remains a realtime transport; SQLite remains the source of truth.

Client to server:

```json
{"command":"dm_send_text","conversation_id":123,"body":"Hola"}
{"command":"dm_mark_read","conversation_id":123,"message_id":456}
{"command":"dm_typing","conversation_id":123,"typing":true}
```

Server to client:

```json
{"type":"dm_message","message":{...}}
{"type":"dm_read","conversation_id":123,"user_id":2,"message_id":456}
{"type":"dm_typing","conversation_id":123,"user_id":2,"typing":true}
```

Text message validation:

- current user must be conversation member
- trim body
- reject empty body
- cap length at 4,000 characters
- persist before broadcasting
- update conversation `updated_at`

## Frontend Modules

The current frontend is TypeScript/Vite with static HTML and inline handlers, not React. The DM MVP should follow the existing module style unless the React migration is restarted first.

Add:

```text
frontend/src/dm.ts
frontend/src/voiceNote.ts
```

Update:

```text
frontend/src/protocol.ts
frontend/src/ws.ts
frontend/src/nav.ts
frontend/src/main.ts
frontend/src/i18n.ts
frontend/src/styles.css
static/index.html
```

### `dm.ts`

Responsibilities:

- open `Mensajes` page
- fetch/render conversation list
- create conversation by email
- open chat screen
- fetch/render messages
- send text messages through WebSocket
- render realtime incoming messages
- mark messages as read

### `voiceNote.ts`

Responsibilities:

- record voice notes with `MediaRecorder`
- preview duration while recording
- cancel recording
- upload voice note with REST
- render local sending state

This must not use `toggleMic()` or the OpenAI translation audio path in `audio.ts`.

## Navigation Rules

Use `app.currentView` and existing `show()` mechanics, but add explicit root-tab behavior:

- `viewLanding`: bottom navbar visible, `Inicio` active
- `viewMessages`: bottom navbar visible, `Mensajes` active
- `viewSettings`: bottom navbar visible, `Ajustes` active
- `viewChat`: bottom navbar hidden
- `viewSolo`: bottom navbar hidden
- `viewRoom`: bottom navbar hidden
- `viewAuth`: bottom navbar hidden

Back behavior:

- from chat -> `viewMessages`
- from solo -> `viewLanding`
- from room -> leave room, then `viewLanding`
- from messages tab -> remains in root tab structure

## Persistence Rules

- Messages are never stored only in memory.
- Every sent text message must be inserted into `dm_messages` before broadcast.
- Every sent voice note must be stored on disk and inserted into `dm_messages` before broadcast.
- Conversation list must be rebuilt from SQLite on page load.
- WebSocket reconnect should not duplicate messages. The UI should rely on message IDs and REST reloads.

## Security And Privacy

- All DM REST and WS actions must verify membership.
- Do not expose conversations by ID unless the current user is a member.
- Do not allow starting a conversation with yourself.
- Do not reveal full user lists.
- `POST /dm/conversations` can reveal whether a specific email is registered; this is acceptable for the MVP because discovery is intentionally email-based. If this becomes public-facing, add rate limits.
- Voice files must use non-guessable filenames and must only be served through authenticated endpoint checks.
- Limit voice note file size and MIME type.
- Escape message text before rendering.

## Testing

Backend verification:

- database initialization creates DM tables
- creating conversation by email works
- duplicate conversation by same two users returns the existing conversation
- self-DM is rejected
- unknown email returns `404`
- non-member cannot list messages
- text message persists and appears in message list
- voice note upload validates membership, MIME, and size

Frontend verification:

- `npm run build`
- conversation list renders empty state and populated state
- new chat by email opens returned conversation
- text send renders optimistically only after server acknowledgement or reconciles by message ID
- chat screen has no bottom navbar
- root screens have `Inicio / Mensajes / Ajustes`
- mobile layout uses full viewport instead of desktop rectangle

Manual browser checks:

- mobile viewport, unauthenticated auth screen
- mobile viewport, root home
- mobile viewport, messages list
- mobile viewport, open chat
- desktop viewport still usable

## Implementation Order

1. Backend schema and DM helper functions in `db.py`.
2. REST endpoints for conversations and message history.
3. WebSocket DM text events.
4. Frontend navigation shell and bottom navbar.
5. Messages list and new-chat-by-email flow.
6. Chat view with text messages.
7. Voice note recording/upload/playback.
8. Mobile full-screen CSS correction.
9. Build and manual verification.
