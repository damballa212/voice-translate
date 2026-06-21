#!/usr/bin/env python3
"""FastAPI server — real-time voice translation via OpenAI gpt-realtime-translate."""

import asyncio
import json
import base64
import os
import threading
import time
import traceback
import secrets
import uuid
import html
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
from openai_translator import OpenAITranslator, OPENAI_LANGS
from logger import log, ok, err
from text_translator import translate_for_members, translate_text as _translate_text
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response, HTTPException
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import db

load_dotenv()

# ============================================================
# Config
# ============================================================
LANGS = {
    "auto": "Detectar auto", "zh": "Chino", "en": "Inglés", "ja": "Japonés",
    "ko": "Coreano", "de": "Alemán", "fr": "Francés", "es": "Español",
    "pt": "Portugués", "ar": "Árabe", "hi": "Hindi", "id": "Indonesio",
    "th": "Tailandés", "tr": "Turco", "vi": "Vietnamita", "ru": "Ruso",
    "it": "Italiano", "nl": "Holandés", "sv": "Sueco", "da": "Danés",
    "fi": "Finlandés", "pl": "Polaco", "cs": "Checo", "fil": "Filipino",
    "ms": "Malayo", "no": "Noruego",
}

# Trial limit per user (0 = unlimited). Override via TRIAL_LIMIT env var.
TRIAL_LIMIT = int(os.getenv("TRIAL_LIMIT", "0"))
VOICE_NOTES_DIR = Path(os.getenv("VOICE_NOTES_DIR", "data/voice-notes"))
VOICE_NOTE_MAX_BYTES = int(os.getenv("VOICE_NOTE_MAX_BYTES", str(10 * 1024 * 1024)))
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_CLAIM_EMAIL = os.getenv("VAPID_CLAIM_EMAIL", "admin@example.com")
VOICE_NOTE_MIME_EXT = {
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
}

try:
    from pywebpush import WebPushException, webpush
except Exception:
    WebPushException = Exception
    webpush = None


# ============================================================
# Room / RoomManager
# ============================================================
def _gen_code():
    """6-char invite code (uppercase + digits, excluding ambiguous O/0/I/1)."""
    pool = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(pool) for _ in range(6))


class Room:
    def __init__(self, code, name="Sala"):
        self.code = code
        self.name = name
        self.created_at = time.time()
        self.members = {}
        self.history = []
        self.lock = threading.Lock()

    @staticmethod
    def _meta(m):
        return {"id": m["id"], "name": m["name"], "target": m["target"], "color": m["color"]}

    def public_members(self):
        with self.lock:
            return [Room._meta(m) for m in self.members.values()]

    def members_snapshot(self):
        with self.lock:
            return list(self.members.values())

    def broadcast(self, msg, except_id=None):
        for m in self.members_snapshot():
            if m["id"] == except_id:
                continue
            try:
                m["send"](msg)
            except Exception as e:
                log("ws", f"broadcast to {m['id']} failed: {e}")


class RoomManager:
    def __init__(self):
        self.rooms = {}
        self.lock = threading.Lock()

    def create(self, name="Sala"):
        for _ in range(8):
            code = _gen_code()
            with self.lock:
                if code not in self.rooms:
                    room = Room(code, name)
                    self.rooms[code] = room
                    return room
        raise RuntimeError("create room: code collision")

    def get(self, code):
        code = (code or "").upper()
        with self.lock:
            if code in self.rooms:
                return self.rooms[code]
        db_row = db.room_get(code)
        if not db_row or db_row.get("closed_at"):
            return None
        room = Room(code, db_row["name"])
        room.created_at = db_row["created_at"]
        with self.lock:
            if code not in self.rooms:
                self.rooms[code] = room
            return self.rooms[code]

    def remove_member(self, code, mid):
        with self.lock:
            room = self.rooms.get(code)
            if not room:
                return
            with room.lock:
                room.members.pop(mid, None)
                empty = not room.members
            if empty:
                self.rooms.pop(code, None)
                log("ws", f"room {code} closed (empty)")


room_manager = RoomManager()


# ============================================================
# DM realtime fanout
# ============================================================
dm_connections = {}
dm_connections_lock = threading.Lock()


def _dm_register(user_id, send):
    with dm_connections_lock:
        dm_connections.setdefault(user_id, set()).add(send)


def _dm_unregister(user_id, send):
    with dm_connections_lock:
        conns = dm_connections.get(user_id)
        if not conns:
            return
        conns.discard(send)
        if not conns:
            dm_connections.pop(user_id, None)


def _dm_broadcast(conversation_id, msg):
    try:
        user_ids = db.dm_conversation_member_ids(conversation_id)
    except Exception as e:
        log("dm", f"member lookup failed: {e}")
        return
    with dm_connections_lock:
        targets = [
            send
            for uid in user_ids
            for send in dm_connections.get(uid, set())
        ]
    for send in targets:
        try:
            send(msg)
        except Exception as e:
            log("dm", f"broadcast failed: {e}")


def _push_enabled():
    return bool(webpush and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def _send_push(subscription, payload):
    if not _push_enabled():
        return False
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": f"mailto:{VAPID_CLAIM_EMAIL}"},
        )
        return True
    except WebPushException as e:
        log("push", f"send failed: {e}")
        return False


def _notify_dm_message(message):
    rows = db.push_list_conversation_recipients(
        message["conversation_id"],
        message["sender_user_id"],
    )
    if not rows:
        return
    title = "Nuevo mensaje"
    body = "Nota de voz" if message.get("kind") == "voice" else (message.get("body") or "Nuevo mensaje")
    body = html.unescape(str(body)).strip()
    if len(body) > 120:
        body = body[:117] + "..."
    payload = {
        "title": title,
        "body": body,
        "url": f"/?chat={message['conversation_id']}",
        "conversation_id": message["conversation_id"],
        "message_id": message["id"],
    }
    for row in rows:
        _send_push(row["subscription"], payload)


# ============================================================
# Recording (persist each session's transcripts — SQLite)
# ============================================================
class RecordingSession:
    def __init__(self, kind, user_id, name=""):
        self.id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
        self.kind = kind
        self.user_id = user_id
        self.name = name or ("Traducción" if kind == "solo" else "Sala grupal")
        self.created_at = time.time()
        self.entries = []
        self.lock = threading.Lock()
        self._created = False

    def add(self, src, tgt, src_lang="", speaker=""):
        if not (src or tgt):
            return
        entry = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "speaker": speaker,
            "src": src,
            "tgt": tgt,
            "src_lang": src_lang,
        }
        with self.lock:
            self.entries.append(entry)
            if not self._created:
                db.insert_recording(self.id, self.user_id, self.kind, self.name, self.created_at)
                self._created = True
            db.append_recording_entry(self.id, entry)


def _render_recording_md(data):
    started = datetime.fromtimestamp(data["created_at"]).strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"# {data.get('name') or data['kind'].upper()}",
        "",
        f"- ID: `{data['id']}`",
        f"- Tipo: {data['kind']}",
        f"- Inicio: {started}",
        f"- Entradas: {len(data.get('entries', []))}",
        "",
        "---",
        "",
    ]
    for e in data.get("entries", []):
        speaker = f"**{e['speaker']}** · " if e.get("speaker") else ""
        sl = (e.get("src_lang") or "").upper() or "?"
        lines.append(f"_{e['ts']}_ · {speaker}({sl})")
        lines.append("")
        if e.get("src"):
            lines.append(f"> {e['src']}")
            lines.append("")
        if e.get("tgt"):
            lines.append(f"→ {e['tgt']}")
            lines.append("")
    return "\n".join(lines)


# ============================================================
# Auth helpers
# ============================================================
COOKIE_NAME = "rt_session"


def _cookie_user(request_or_ws):
    try:
        token = request_or_ws.cookies.get(COOKIE_NAME)
    except Exception:
        token = None
    return db.get_session_user(token) if token else None


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=db.SESSION_TTL, httponly=True, samesite="lax", path="/",
    )


app = FastAPI()


# ============================================================
# Anti-hallucination filter
# ============================================================
def _is_likely_hallucination(text):
    t = (text or "").strip().rstrip("。.!?,,!?、 ")
    if not t:
        return True
    if len(t) >= 6 and len(set(t)) <= 2:
        return True
    return False


# ============================================================
# WebSocket endpoint
# ============================================================
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    user = _cookie_user(ws)
    if not user:
        await ws.accept()
        await ws.send_json({"type": "error", "message": "No has iniciado sesión", "code": "auth_required"})
        await ws.close()
        return
    await ws.accept()

    config = {
        "lang": "auto",
        "target": "es",
        "translate": True,
        "tts": False,
    }
    openai_client = None
    openai_lock = asyncio.Lock()
    audio_in_count = 0
    audio_in_bytes = 0
    audio_in_last_log = time.time()
    running = threading.Event()
    outbox = asyncio.Queue()
    main_loop = asyncio.get_running_loop()

    member_id = uuid.uuid4().hex[:8]
    current_room = None

    recording_session = RecordingSession("solo", user_id=user["id"])

    speak_turn_id = None
    speak_src_acc = ""
    speak_tgt_acc = ""

    def _send_threadsafe(msg):
        main_loop.call_soon_threadsafe(outbox.put_nowait, msg)

    _dm_register(user["id"], _send_threadsafe)

    async def sender():
        while True:
            msg = await outbox.get()
            if msg is None:
                break
            await ws.send_json(msg)

    sender_task = asyncio.create_task(sender())

    await outbox.put({"type": "welcome", "recording_id": recording_session.id})

    # ── OpenAI solo callbacks ──

    def on_openai_partial_src(delta):
        main_loop.call_soon_threadsafe(outbox.put_nowait, {
            "type": "transcript", "text": delta, "lang": "?", "incremental": True,
        })

    def on_openai_partial_tgt(delta):
        main_loop.call_soon_threadsafe(outbox.put_nowait, {
            "type": "translation", "text": delta, "incremental": True,
        })

    def on_openai_audio(pcm, sr):
        if not config.get("tts"):
            return
        b64 = base64.b64encode(pcm).decode()
        main_loop.call_soon_threadsafe(outbox.put_nowait, {
            "type": "audio", "data": b64, "sample_rate": sr,
        })

    def on_openai_session_lost():
        try:
            asyncio.run_coroutine_threadsafe(_reconnect_openai(), main_loop)
        except Exception as e:
            log("openai", f"schedule reconnect failed: {e}")

    async def _reconnect_openai():
        nonlocal openai_client
        async with openai_lock:
            if not running.is_set():
                return
            log("openai", "session lost — reconnecting")
            old = openai_client
            nc = OpenAITranslator(
                target_lang=config["target"],
                on_partial_src=on_openai_partial_src,
                on_partial_tgt=on_openai_partial_tgt,
                on_audio=on_openai_audio,
                on_session_lost=on_openai_session_lost,
            )
            connected = await main_loop.run_in_executor(None, nc.connect)
            if connected:
                openai_client = nc
                ok("openai", "auto-reconnected")
                if old:
                    try:
                        old.close()
                    except Exception:
                        pass
            else:
                err("openai", "auto-reconnect failed")

    # ── OpenAI room callbacks ──

    def on_room_openai_src(delta):
        nonlocal speak_src_acc
        if not current_room or not speak_turn_id:
            return
        speaker = current_room.members.get(member_id)
        if not speaker:
            return
        speak_src_acc += delta
        ts = datetime.now().strftime("%H:%M:%S")
        msg = {
            "type": "room_message",
            "turn_id": speak_turn_id, "speaker_id": member_id,
            "speaker_name": speaker["name"], "src_lang": "?",
            "text": delta, "incremental": True, "ts": ts,
        }
        for m in current_room.members_snapshot():
            try:
                m["send"](msg)
            except Exception:
                pass

    def on_room_openai_tgt(delta):
        nonlocal speak_tgt_acc
        if not current_room or not speak_turn_id:
            return
        speak_tgt_acc += delta
        speaker_target = config.get("target", "es")
        ts = datetime.now().strftime("%H:%M:%S")
        msg = {
            "type": "room_translation",
            "turn_id": speak_turn_id, "speaker_id": member_id,
            "text": delta, "target_lang": speaker_target,
            "incremental": True, "ts": ts,
        }
        for m in current_room.members_snapshot():
            try:
                m["send"](msg)
            except Exception:
                pass

    def on_room_openai_audio(pcm, sr):
        if not current_room or not config.get("tts"):
            return
        b64 = base64.b64encode(pcm).decode()
        msg = {"type": "audio", "data": b64, "sample_rate": sr}
        for m in current_room.members_snapshot():
            try:
                m["send"](msg)
            except Exception:
                pass

    # ── Command dispatch ──

    try:
        while True:
            msg = await ws.receive_json()
            cmd = msg.get("command")

            if cmd == "start":
                used = db.count_recordings_by_user(user["id"])
                if TRIAL_LIMIT and used >= TRIAL_LIMIT:
                    log("ws", f"trial limit reached for user {user['id']} ({used}/{TRIAL_LIMIT})")
                    await outbox.put({
                        "type": "error",
                        "code": "trial_limit",
                        "message": f"Límite de prueba alcanzado ({used}/{TRIAL_LIMIT})",
                        "used": used,
                        "limit": TRIAL_LIMIT,
                    })
                    continue

                config.update({
                    "lang": msg.get("lang", config["lang"]),
                    "target": msg.get("target", config["target"]),
                    "translate": msg.get("translate", config["translate"]),
                    "tts": msg.get("tts", config["tts"]),
                })
                running.set()

                if recording_session.entries:
                    recording_session = RecordingSession("solo", user_id=user["id"])
                    log("ws", f"new recording: {recording_session.id}")

                log("openai", f"→ connect target={config['target']}")
                openai_client = OpenAITranslator(
                    target_lang=config["target"],
                    on_partial_src=on_openai_partial_src,
                    on_partial_tgt=on_openai_partial_tgt,
                    on_audio=on_openai_audio,
                    on_session_lost=on_openai_session_lost,
                )
                if openai_client.connect():
                    await outbox.put({"type": "ready", "engine": "openai", "recording_id": recording_session.id})
                else:
                    running.clear()
                    openai_client = None
                    await outbox.put({"type": "error", "message": "Conexión con OpenAI fallida (verifica OPENAI_API_KEY)"})

            elif cmd == "audio":
                if running.is_set() and openai_client:
                    try:
                        pcm24 = base64.b64decode(msg["data"])
                        audio_in_count += 1
                        audio_in_bytes += len(pcm24)
                        now = time.time()
                        if now - audio_in_last_log >= 2.0:
                            log("ws", f"← audio in: {audio_in_count} chunks / {audio_in_bytes} bytes (last 2s)")
                            audio_in_count = 0
                            audio_in_bytes = 0
                            audio_in_last_log = now
                        openai_client.send_audio(pcm24)
                    except Exception as e:
                        running.clear()
                        err("ws", f"audio send: {e}")
                        traceback.print_exc()
                        await outbox.put({"type": "error", "message": "Error enviando audio, reinicia la grabación"})

            elif cmd == "stop":
                running.clear()
                if openai_client:
                    openai_client.close()
                    openai_client = None
                await outbox.put({"type": "stopped"})

            elif cmd == "update_config":
                old_target = config.get("target")
                for k in ("lang", "target", "translate", "tts"):
                    if k in msg:
                        config[k] = msg[k]
                log("ws", f"update_config target {old_target}→{config['target']}")
                if openai_client and config["target"] != old_target:
                    log("openai", f"update_target_lang → {config['target']}")
                    openai_client.update_target_lang(config["target"])
                await outbox.put({"type": "config_updated",
                                  "translate": config["translate"], "tts": config["tts"]})

            elif cmd == "create_room":
                if current_room:
                    await outbox.put({"type": "error", "message": "Ya estás en una sala"})
                else:
                    rname = (msg.get("room_name") or "Sala").strip()[:40]
                    nick = (msg.get("name") or "Yo").strip()[:20]
                    target = msg.get("target", "es")
                    room = room_manager.create(rname)
                    db.room_create(room.code, rname, user["id"])
                    color = 0
                    room.members[member_id] = {
                        "id": member_id, "name": nick, "target": target, "color": color,
                        "send": _send_threadsafe, "speaking": False,
                    }
                    db.room_add_member(room.code, user["id"], nick, target, color)
                    current_room = room
                    config["target"] = target
                    log("ws", f"create_room code={room.code} by {nick} target={target}")
                    await outbox.put({
                        "type": "room_joined",
                        "code": room.code,
                        "room_name": room.name,
                        "members": room.public_members(),
                        "you": member_id,
                        "your_target": target,
                    })

            elif cmd == "join_room":
                if current_room:
                    await outbox.put({"type": "error", "message": "Ya estás en una sala"})
                else:
                    code = (msg.get("code") or "").upper().strip()
                    room = room_manager.get(code)
                    if not room:
                        db_row = db.room_get(code)
                        if db_row and db_row.get("closed_at"):
                            await outbox.put({"type": "error", "message": f"La sala {code} ya terminó"})
                        else:
                            await outbox.put({"type": "error", "message": f"El código {code} no existe"})
                    else:
                        nick = (msg.get("name") or "Yo").strip()[:20]
                        target = msg.get("target", "es")
                        used_colors = {m["color"] for m in room.members.values()}
                        color = next((i for i in range(5) if i not in used_colors), 0)
                        new_meta = {"id": member_id, "name": nick, "target": target, "color": color}
                        room.members[member_id] = {
                            **new_meta, "send": _send_threadsafe, "speaking": False,
                        }
                        db.room_add_member(code, user["id"], nick, target, color)
                        current_room = room
                        config["target"] = target
                        log("ws", f"join_room code={room.code} by {nick} target={target}")
                        room.broadcast({"type": "member_joined", "member": new_meta}, except_id=member_id)
                        await outbox.put({
                            "type": "room_joined",
                            "code": room.code,
                            "room_name": room.name,
                            "members": room.public_members(),
                            "you": member_id,
                            "your_target": target,
                        })

            elif cmd == "leave_room":
                if current_room:
                    code = current_room.code
                    current_room.broadcast({"type": "member_left", "id": member_id}, except_id=member_id)
                    room_manager.remove_member(code, member_id)
                    db.room_mark_member_left(code, user["id"])
                    if not db.room_list_members(code, active_only=True):
                        db.room_close(code)
                        log("ws", f"room {code} closed (all members left)")
                    log("ws", f"leave_room code={code} by {member_id}")
                    current_room = None

            elif cmd == "speak_start":
                if current_room:
                    running.set()
                    speaker_target = config.get("target", "es")
                    speak_turn_id = uuid.uuid4().hex[:8]
                    if not openai_client:
                        log("openai", f"room speak_start target={speaker_target}")
                        openai_client = OpenAITranslator(
                            target_lang=speaker_target,
                            on_partial_src=on_room_openai_src,
                            on_partial_tgt=on_room_openai_tgt,
                            on_audio=on_room_openai_audio,
                            on_session_lost=on_openai_session_lost,
                        )
                        if not openai_client.connect():
                            openai_client = None
                            running.clear()
                            await outbox.put({"type": "error", "message": "Conexión con OpenAI fallida"})
                            continue
                    current_room.members[member_id]["speaking"] = True
                    current_room.broadcast({"type": "speaking", "id": member_id, "speaking": True})
                    await outbox.put({"type": "ready", "engine": "openai"})

            elif cmd == "speak_stop":
                if current_room:
                    running.clear()
                    if openai_client:
                        try:
                            openai_client.close()
                        except Exception:
                            pass
                        openai_client = None
                    if speak_src_acc.strip() or speak_tgt_acc.strip():
                        speaker = current_room.members.get(member_id) or {}
                        speaker_target = config.get("target", "es")
                        translations = {speaker_target: speak_tgt_acc.strip()} if speak_tgt_acc.strip() else {}
                        db.room_add_message(
                            code=current_room.code,
                            speaker_user_id=user["id"],
                            speaker_name=speaker.get("name", "?"),
                            src_lang="?",
                            src=speak_src_acc.strip(),
                            translations=translations,
                        )
                    speak_src_acc = ""
                    speak_tgt_acc = ""
                    speak_turn_id = None
                    current_room.members[member_id]["speaking"] = False
                    current_room.broadcast({"type": "speaking", "id": member_id, "speaking": False})
                    await outbox.put({"type": "stopped"})

            elif cmd == "record_entry":
                if recording_session:
                    recording_session.add(
                        src=(msg.get("src") or "").strip(),
                        tgt=(msg.get("tgt") or "").strip(),
                        src_lang=msg.get("lang") or "",
                        speaker=msg.get("speaker") or "",
                    )

            elif cmd == "dm_send_text":
                try:
                    conversation_id = int(msg.get("conversation_id") or 0)
                    body = msg.get("body") or ""
                    members = db.dm_member_target_langs(conversation_id)
                    sender_id = user["id"]
                    sender_member = next((m for m in members if m["user_id"] == sender_id), None)
                    sender_native = (sender_member.get("native_lang") or "").strip() if sender_member else ""
                    target_langs = [
                        m["native_lang"] for m in members
                        if m["user_id"] != sender_id
                        and (m.get("native_lang") or "").strip()
                        and (m.get("native_lang") or "").strip() != sender_native
                    ]
                    log("dm", f"send_text conv={conversation_id} body={body!r:.40} sender_native={sender_native!r} target_langs={target_langs}")
                    translations = {}
                    if target_langs:
                        try:
                            translations = await translate_for_members(
                                body, target_langs,
                                source_hint=sender_native or None,
                                sender_name=user.get("nickname") or user.get("email"),
                            )
                            log("dm", f"translated → {translations}")
                        except Exception as e:
                            err("dm", f"translate failed, sending without translation: {e}")
                    else:
                        log("dm", f"same native_lang={sender_native!r} or not configured — skipping translation")
                    saved = db.dm_add_text_message(conversation_id, sender_id, body, translations)
                    _dm_broadcast(conversation_id, {
                        "type": "dm_message",
                        "message": saved,
                    })
                    _notify_dm_message(saved)
                except PermissionError:
                    await outbox.put({"type": "error", "message": "No tienes acceso a esta conversación"})
                except ValueError as e:
                    await outbox.put({"type": "error", "message": str(e)})
                except Exception as e:
                    err("dm", f"send_text: {e}")
                    await outbox.put({"type": "error", "message": "No se pudo enviar el mensaje"})

            elif cmd == "dm_mark_read":
                try:
                    conversation_id = int(msg.get("conversation_id") or 0)
                    message_id = int(msg.get("message_id") or 0)
                    db.dm_mark_read(conversation_id, user["id"], message_id)
                    _dm_broadcast(conversation_id, {
                        "type": "dm_read",
                        "conversation_id": conversation_id,
                        "user_id": user["id"],
                        "message_id": message_id,
                    })
                except PermissionError:
                    await outbox.put({"type": "error", "message": "No tienes acceso a esta conversación"})
                except Exception as e:
                    err("dm", f"mark_read: {e}")

            elif cmd == "dm_typing":
                try:
                    conversation_id = int(msg.get("conversation_id") or 0)
                    if not db.dm_is_member(conversation_id, user["id"]):
                        raise PermissionError()
                    _dm_broadcast(conversation_id, {
                        "type": "dm_typing",
                        "conversation_id": conversation_id,
                        "user_id": user["id"],
                        "typing": bool(msg.get("typing")),
                    })
                except PermissionError:
                    await outbox.put({"type": "error", "message": "No tienes acceso a esta conversación"})

            elif cmd == "dm_set_lang":
                try:
                    conversation_id = int(msg.get("conversation_id") or 0)
                    target_lang = (msg.get("target_lang") or "en").strip().lower()
                    if db.dm_is_member(conversation_id, user["id"]):
                        db.dm_set_member_target_lang(conversation_id, user["id"], target_lang)
                except Exception as e:
                    err("dm", f"dm_set_lang: {e}")

            elif cmd == "dm_translate_bubble":
                try:
                    message_id = int(msg.get("message_id") or 0)
                    target_lang = (msg.get("target_lang") or "en").strip().lower()
                    message = db.dm_get_message(message_id, user["id"])
                    if not message:
                        raise PermissionError("Mensaje no encontrado")
                    text = (message.get("body") or message.get("transcript") or "").strip()
                    if not text:
                        await outbox.put({"type": "error", "message": "Nada que traducir"})
                    else:
                        result = await _translate_text(text, target_lang)
                        await outbox.put({
                            "type": "dm_bubble_translation",
                            "message_id": message_id,
                            "target_lang": target_lang,
                            "translated": result["translated"],
                            "source_lang": result["source_lang"],
                        })
                except PermissionError:
                    await outbox.put({"type": "error", "message": "No tienes acceso"})
                except Exception as e:
                    err("dm", f"dm_translate_bubble: {e}")

            elif cmd == "ping":
                await outbox.put({"type": "pong"})

    except WebSocketDisconnect:
        log("ws", "client disconnected")
    except Exception as e:
        err("ws", f"endpoint: {e}")
        traceback.print_exc()
        try:
            await outbox.put({"type": "error", "message": "Error de conexión, recarga la página"})
        except Exception:
            pass
    finally:
        running.clear()
        if openai_client:
            try:
                openai_client.close()
            except Exception:
                pass
        if current_room:
            try:
                code = current_room.code
                current_room.broadcast({"type": "member_left", "id": member_id}, except_id=member_id)
                room_manager.remove_member(code, member_id)
                log("ws", f"disconnect cleanup: removed {member_id} from {code}")
            except Exception:
                pass
        _dm_unregister(user["id"], _send_threadsafe)
        await outbox.put(None)
        sender_task.cancel()


# ============================================================
# Static assets
# ============================================================
@app.get("/")
async def index():
    return FileResponse("static/index.html")


@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse("static/manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    return FileResponse("static/sw.js", media_type="application/javascript")


@app.get("/langs")
async def get_langs():
    return LANGS


# ============================================================
# Auth routes
# ============================================================
@app.post("/auth/register")
async def auth_register(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    nickname = (body.get("nickname") or "").strip() or email.split("@")[0]
    if not email or "@" not in email or "." not in email:
        raise HTTPException(400, "Formato de correo incorrecto")
    if len(password) < 6:
        raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres")
    if db.find_user_by_email(email):
        raise HTTPException(409, "Este correo ya está registrado")
    user = db.create_user(email, password, nickname)
    if not user:
        raise HTTPException(500, "Error al registrar, intenta más tarde")
    token = db.create_session(user["id"])
    resp = JSONResponse({"user": user})
    _set_session_cookie(resp, token)
    return resp


@app.post("/auth/login")
async def auth_login(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    user = db.authenticate(email, password)
    if not user:
        raise HTTPException(401, "Correo o contraseña incorrectos")
    token = db.create_session(user["id"])
    resp = JSONResponse({"user": user})
    _set_session_cookie(resp, token)
    return resp


@app.post("/auth/logout")
async def auth_logout(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        db.revoke_session(token)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp


@app.get("/auth/me")
async def auth_me(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    used = db.count_recordings_by_user(u["id"])
    return {**u, "trial": {"used": used, "limit": TRIAL_LIMIT}}


@app.post("/auth/native-lang")
async def auth_set_native_lang(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    body = await request.json()
    lang = (body.get("native_lang") or "").strip().lower()
    if not lang or len(lang) > 10:
        raise HTTPException(400, "Idioma inválido")
    db.set_native_lang(u["id"], lang)
    updated = db.get_user(u["id"])
    return updated


# ============================================================
# Recordings
# ============================================================
@app.get("/recordings")
async def list_recordings(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    return db.list_recordings_for_user(u["id"])


@app.get("/recordings/{rec_id}.md")
async def download_recording(rec_id: str, request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    rec = db.get_recording(rec_id, u["id"])
    if not rec:
        return Response(content=f"# {rec_id} no existe", media_type="text/markdown; charset=utf-8")
    md = _render_recording_md(rec)
    safe = "".join(c for c in rec_id if c.isalnum() or c in "-_")
    return Response(
        content=md,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe}.md"},
    )


@app.delete("/recordings/{rec_id}")
async def delete_recording_ep(rec_id: str, request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    ok_flag = db.delete_recording(rec_id, u["id"])
    return {"ok": ok_flag}


# ============================================================
# Rooms
# ============================================================
@app.get("/rooms")
async def list_my_rooms(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    return db.rooms_for_user(u["id"])


@app.get("/export")
async def export_room(code: str, request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    db_room = db.room_get(code)
    if not db_room:
        return Response(content=f"# Sala {code} no existe", media_type="text/markdown; charset=utf-8")
    msgs = db.room_list_messages(code)
    members = db.room_list_members(code, active_only=False)
    started = datetime.fromtimestamp(db_room["created_at"]).strftime("%Y-%m-%d %H:%M")
    member_line = ", ".join(f'{m["nickname"]} ({(m["target_lang"] or "").upper()})' for m in members)
    closed_line = ""
    if db_room.get("closed_at"):
        cat = datetime.fromtimestamp(db_room["closed_at"]).strftime("%Y-%m-%d %H:%M")
        closed_line = f"- Fin: {cat}"
    lines = [
        f"# {db_room['name']}",
        "",
        f"- Código: `{code}`",
        f"- Inicio: {started}",
    ]
    if closed_line:
        lines.append(closed_line)
    lines += [
        f"- Miembros: {member_line}",
        f"- Entradas: {len(msgs)}",
        "",
        "## Conversación",
        "",
    ]
    for m in msgs:
        ts = datetime.fromtimestamp(m["ts"]).strftime("%H:%M:%S")
        sl = (m.get("src_lang") or "?").upper()
        lines.append(f"**[{ts}] {m['speaker_name']}** _({sl})_")
        lines.append("")
        lines.append(f"> {m['src']}")
        lines.append("")
        for tgt, text in (m.get("translations") or {}).items():
            lines.append(f"- **→ {tgt.upper()}**: {text}")
        lines.append("")
    md = "\n".join(lines)
    return Response(
        content=md,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={code}-{int(time.time())}.md"},
    )


# ============================================================
# Direct messages
# ============================================================
@app.get("/dm/conversations")
async def dm_list_conversations(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    return db.dm_list_conversations(u["id"])


@app.post("/dm/conversations")
async def dm_create_conversation(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    body = await request.json()
    try:
        return db.dm_create_or_get_conversation(u["id"], body.get("email") or "")
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/dm/conversations/{conversation_id}/messages")
async def dm_list_messages(conversation_id: int, request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    try:
        return db.dm_list_messages(conversation_id, u["id"])
    except PermissionError as e:
        raise HTTPException(403, str(e))


@app.post("/dm/conversations/{conversation_id}/voice")
async def dm_upload_voice(conversation_id: int, request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    if not db.dm_is_member(conversation_id, u["id"]):
        raise HTTPException(403, "No tienes acceso a esta conversación")

    mime = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if mime not in VOICE_NOTE_MIME_EXT:
        raise HTTPException(415, "Tipo de audio no permitido")

    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > VOICE_NOTE_MAX_BYTES:
        raise HTTPException(413, "La nota de voz es demasiado grande")

    data = await request.body()
    if not data:
        raise HTTPException(400, "La nota de voz está vacía")
    if len(data) > VOICE_NOTE_MAX_BYTES:
        raise HTTPException(413, "La nota de voz es demasiado grande")

    try:
        duration_ms = int(request.headers.get("x-voice-duration-ms") or "0")
    except ValueError:
        duration_ms = 0
    duration_ms = max(0, min(duration_ms, 30 * 60 * 1000))

    VOICE_NOTES_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{conversation_id}-{u['id']}-{secrets.token_urlsafe(18)}{VOICE_NOTE_MIME_EXT[mime]}"
    path = VOICE_NOTES_DIR / filename
    path.write_bytes(data)

    transcript = None
    translations: dict = {}

    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key:
        try:
            import httpx as _httpx
            import io
            ext = VOICE_NOTE_MIME_EXT.get(mime, ".webm")
            fname = f"voice{ext}"
            async with _httpx.AsyncClient(timeout=20) as client:
                asr_r = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    files={"file": (fname, io.BytesIO(data), mime)},
                    data={"model": "whisper-1"},
                )
                if asr_r.status_code == 200:
                    transcript = (asr_r.json().get("text") or "").strip() or None
        except Exception as e:
            err("asr", f"whisper transcription failed: {e}")

    if transcript:
        try:
            members = db.dm_member_target_langs(conversation_id)
            sender_native = ""
            sender_member = next((m for m in members if m["user_id"] == u["id"]), None)
            if sender_member:
                sender_native = (sender_member.get("native_lang") or "").strip()
            target_langs = [
                m["native_lang"] for m in members
                if m["user_id"] != u["id"]
                and (m.get("native_lang") or "").strip()
                and (m.get("native_lang") or "").strip() != sender_native
            ]
            if target_langs:
                translations = await translate_for_members(
                    transcript, target_langs,
                    source_hint=sender_native or None,
                    sender_name=u.get("nickname") or u.get("email"),
                )
        except Exception as e:
            err("dm", f"voice note translation failed: {e}")

    try:
        msg = db.dm_add_voice_message(
            conversation_id=conversation_id,
            sender_user_id=u["id"],
            path=str(path),
            mime=mime,
            duration_ms=duration_ms,
            size_bytes=len(data),
            transcript=transcript,
            translations_json=translations or None,
        )
    except Exception:
        try:
            path.unlink()
        except Exception:
            pass
        raise

    _dm_broadcast(conversation_id, {"type": "dm_message", "message": msg})
    _notify_dm_message(msg)
    return msg


@app.get("/dm/voice/{message_id}")
async def dm_voice(message_id: int, request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    msg = db.dm_get_message(message_id, u["id"])
    if not msg or msg.get("kind") != "voice" or not msg.get("voice_path"):
        raise HTTPException(404, "Nota de voz no encontrada")
    path = Path(msg["voice_path"])
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Nota de voz no encontrada")
    return FileResponse(path, media_type=msg.get("voice_mime") or "application/octet-stream")


@app.get("/dm/tts/{message_id}")
async def dm_tts(message_id: int, request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    msg = db.dm_get_message(message_id, u["id"])
    if not msg:
        raise HTTPException(404, "Mensaje no encontrado")
    text = (msg.get("body") or msg.get("transcript") or "").strip()
    if not text:
        raise HTTPException(400, "Nada que leer")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_key:
        raise HTTPException(503, "TTS no disponible")
    import httpx as _httpx
    tts_payload = {
        "model": "tts-1",
        "input": text[:500],
        "voice": "alloy",
        "response_format": "mp3",
    }
    async with _httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
            json=tts_payload,
        )
        if r.status_code != 200:
            raise HTTPException(502, "TTS backend error")
        return Response(
            content=r.content,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )


# ============================================================
# Web Push / PWA notifications
# ============================================================
@app.get("/push/config")
async def push_config(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    return {"enabled": _push_enabled(), "publicKey": VAPID_PUBLIC_KEY}


@app.post("/push/subscriptions")
async def push_subscribe(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    body = await request.json()
    try:
        sub = db.push_save_subscription(u["id"], body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "subscription": sub, "enabled": _push_enabled()}


@app.delete("/push/subscriptions")
async def push_unsubscribe(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    body = await request.json()
    endpoint = (body.get("endpoint") or "").strip()
    if endpoint:
        db.push_delete_subscription(u["id"], endpoint)
    return {"ok": True}


# ============================================================
# Admin dashboard
# ============================================================
@app.get("/admin/stats")
async def admin_stats_page(request: Request):
    u = _cookie_user(request)
    if not u:
        return RedirectResponse(url="/", status_code=302)
    return FileResponse("static/admin.html")


@app.get("/admin/api/stats")
async def admin_api_stats(request: Request):
    u = _cookie_user(request)
    if not u:
        raise HTTPException(401, "No has iniciado sesión")
    return {
        "overview": db.stats_overview(),
        "daily": db.daily_recordings(days=7),
        "top_users": db.top_users_by_recordings(limit=10),
        "trial_limit": TRIAL_LIMIT,
    }


app.mount("/assets", StaticFiles(directory="static/assets"), name="static-assets")
app.mount("/icons", StaticFiles(directory="static/icons"), name="static-icons")

if __name__ == "__main__":
    os.makedirs("static", exist_ok=True)
    uvicorn.run(app, host="0.0.0.0", port=8800, log_level="info")
