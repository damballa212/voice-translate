"""SQLite + 简易认证 (scrypt + session cookie)

无第三方依赖, 全部用 Python 标准库.
"""
import sqlite3
import time
import secrets
import hashlib
import json
import os
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "app.db")
SESSION_TTL = 30 * 24 * 3600   # 30 天


@contextmanager
def conn():
    """每次调用开一个新 connection — WAL 模式支持并发读+单 writer, 无需 Python 层锁"""
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.execute("PRAGMA foreign_keys=ON")
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init():
    with conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            nickname TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS recordings (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at REAL NOT NULL,
            entries_json TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_recordings_user ON recordings(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS rooms (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host_user_id INTEGER NOT NULL,
            created_at REAL NOT NULL,
            closed_at REAL,
            FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS room_members (
            room_code TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            nickname TEXT NOT NULL,
            target_lang TEXT NOT NULL,
            color INTEGER NOT NULL DEFAULT 0,
            joined_at REAL NOT NULL,
            left_at REAL,
            PRIMARY KEY (room_code, user_id),
            FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS room_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT NOT NULL,
            speaker_user_id INTEGER NOT NULL,
            speaker_name TEXT NOT NULL,
            src_lang TEXT,
            src TEXT,
            translations_json TEXT NOT NULL DEFAULT '{}',
            ts REAL NOT NULL,
            FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_room_messages ON room_messages(room_code, ts);
        CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

        CREATE TABLE IF NOT EXISTS dm_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dm_members (
            conversation_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            joined_at REAL NOT NULL,
            last_read_message_id INTEGER,
            PRIMARY KEY (conversation_id, user_id),
            FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS dm_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            sender_user_id INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('text', 'voice', 'image')),
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
        CREATE INDEX IF NOT EXISTS idx_dm_members_user ON dm_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation ON dm_messages(conversation_id, created_at, id);
        CREATE INDEX IF NOT EXISTS idx_dm_conversations_updated ON dm_conversations(updated_at DESC);

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            endpoint TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            subscription_json TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
        """)
        for sql in [
            "ALTER TABLE dm_messages ADD COLUMN translations_json TEXT NOT NULL DEFAULT '{}'",
            "ALTER TABLE dm_messages ADD COLUMN transcript TEXT",
            "ALTER TABLE dm_members ADD COLUMN target_lang TEXT NOT NULL DEFAULT 'en'",
            "ALTER TABLE users ADD COLUMN native_lang TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE dm_messages ADD COLUMN image_url TEXT",
            "ALTER TABLE dm_messages ADD COLUMN reply_to_id INTEGER",
        ]:
            try:
                c.execute(sql)
            except Exception:
                pass

        try:
            row = c.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='dm_messages'"
            ).fetchone()
            if row and "'text', 'voice')" in (row["sql"] or "") and "'image'" not in (row["sql"] or ""):
                c.executescript("""
                    CREATE TABLE dm_messages_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id INTEGER NOT NULL,
                        sender_user_id INTEGER NOT NULL,
                        kind TEXT NOT NULL CHECK (kind IN ('text', 'voice', 'image')),
                        body TEXT,
                        voice_path TEXT,
                        voice_mime TEXT,
                        voice_duration_ms INTEGER,
                        voice_size_bytes INTEGER,
                        created_at REAL NOT NULL,
                        deleted_at REAL,
                        translations_json TEXT NOT NULL DEFAULT '{}',
                        transcript TEXT,
                        image_url TEXT,
                        reply_to_id INTEGER,
                        FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
                        FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
                    );
                    INSERT INTO dm_messages_new
                        SELECT id, conversation_id, sender_user_id, kind, body,
                               voice_path, voice_mime, voice_duration_ms, voice_size_bytes,
                               created_at, deleted_at, translations_json, transcript,
                               image_url, reply_to_id
                        FROM dm_messages;
                    DROP TABLE dm_messages;
                    ALTER TABLE dm_messages_new RENAME TO dm_messages;
                    CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation
                        ON dm_messages(conversation_id, created_at, id);
                """)
        except Exception:
            pass


# ============================================================
# 密码哈希
# ============================================================
def hash_password(pwd: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pwd.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return salt.hex() + ":" + h.hex()


def verify_password(pwd: str, hashed: str) -> bool:
    try:
        salt_hex, h_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        h = hashlib.scrypt(pwd.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
        return secrets.compare_digest(h.hex(), h_hex)
    except Exception:
        return False


# ============================================================
# 用户
# ============================================================
def create_user(email: str, password: str, nickname: str) -> Optional[dict]:
    email = email.strip().lower()
    nickname = nickname.strip()[:30]
    if not email or not password or not nickname:
        return None
    try:
        with conn() as c:
            cur = c.execute(
                "INSERT INTO users (email, nickname, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (email, nickname, hash_password(password), time.time()),
            )
            uid = cur.lastrowid
        return get_user(uid)
    except sqlite3.IntegrityError:
        return None


def get_user(user_id: int) -> Optional[dict]:
    with conn() as c:
        row = c.execute("SELECT id, email, nickname, native_lang, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def find_user_by_email(email: str) -> Optional[dict]:
    with conn() as c:
        row = c.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
        return dict(row) if row else None


def set_native_lang(user_id: int, native_lang: str) -> None:
    lang = (native_lang or "").strip().lower()
    with conn() as c:
        c.execute("UPDATE users SET native_lang = ? WHERE id = ?", (lang, user_id))


def authenticate(email: str, password: str) -> Optional[dict]:
    u = find_user_by_email(email)
    if not u: return None
    if not verify_password(password, u["password_hash"]): return None
    return {"id": u["id"], "email": u["email"], "nickname": u["nickname"], "native_lang": u.get("native_lang", "")}


# ============================================================
# Session
# ============================================================
def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with conn() as c:
        c.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now, now + SESSION_TTL),
        )
    return token


def get_session_user(token: str) -> Optional[dict]:
    if not token: return None
    with conn() as c:
        row = c.execute("""
            SELECT u.id, u.email, u.nickname, u.native_lang FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
        """, (token, time.time())).fetchone()
        return dict(row) if row else None


def revoke_session(token: str):
    with conn() as c:
        c.execute("DELETE FROM sessions WHERE token = ?", (token,))


def insert_recording(rec_id: str, user_id: int, kind: str, name: str, created_at: float):
    with conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO recordings (id, user_id, kind, name, created_at, entries_json) VALUES (?, ?, ?, ?, ?, '[]')",
            (rec_id, user_id, kind, name, created_at),
        )


def append_recording_entry(rec_id: str, entry: dict):
    """读 entries JSON, append, 写回."""
    with conn() as c:
        row = c.execute("SELECT entries_json FROM recordings WHERE id = ?", (rec_id,)).fetchone()
        if not row: return
        try:
            entries = json.loads(row["entries_json"])
        except Exception:
            entries = []
        entries.append(entry)
        c.execute("UPDATE recordings SET entries_json = ? WHERE id = ?",
                  (json.dumps(entries, ensure_ascii=False), rec_id))


def list_recordings_for_user(user_id: int) -> list:
    with conn() as c:
        rows = c.execute(
            "SELECT id, kind, name, created_at, entries_json FROM recordings WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    out = []
    for r in rows:
        try:
            count = len(json.loads(r["entries_json"]))
        except Exception:
            count = 0
        out.append({
            "id": r["id"], "kind": r["kind"], "name": r["name"],
            "created_at": r["created_at"], "count": count,
        })
    return out


def get_recording(rec_id: str, user_id: int) -> Optional[dict]:
    with conn() as c:
        row = c.execute(
            "SELECT id, user_id, kind, name, created_at, entries_json FROM recordings WHERE id = ? AND user_id = ?",
            (rec_id, user_id),
        ).fetchone()
    if not row: return None
    d = dict(row)
    try:
        d["entries"] = json.loads(d.pop("entries_json"))
    except Exception:
        d["entries"] = []
    return d


def delete_recording(rec_id: str, user_id: int) -> bool:
    with conn() as c:
        cur = c.execute("DELETE FROM recordings WHERE id = ? AND user_id = ?", (rec_id, user_id))
        return cur.rowcount > 0


# ============================================================
# Rooms (群组持久化)
# ============================================================
def room_create(code: str, name: str, host_user_id: int) -> dict:
    now = time.time()
    with conn() as c:
        c.execute("INSERT INTO rooms (code, name, host_user_id, created_at) VALUES (?, ?, ?, ?)",
                  (code, name, host_user_id, now))
    return {"code": code, "name": name, "host_user_id": host_user_id, "created_at": now, "closed_at": None}


def room_get(code: str) -> Optional[dict]:
    with conn() as c:
        row = c.execute("SELECT code, name, host_user_id, created_at, closed_at FROM rooms WHERE code = ?",
                        (code,)).fetchone()
        return dict(row) if row else None


def room_close(code: str):
    with conn() as c:
        c.execute("UPDATE rooms SET closed_at = ? WHERE code = ? AND closed_at IS NULL",
                  (time.time(), code))


def room_add_member(code: str, user_id: int, nickname: str, target_lang: str, color: int):
    with conn() as c:
        c.execute("""
            INSERT INTO room_members (room_code, user_id, nickname, target_lang, color, joined_at, left_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(room_code, user_id) DO UPDATE SET
                nickname = excluded.nickname,
                target_lang = excluded.target_lang,
                joined_at = excluded.joined_at,
                left_at = NULL
        """, (code, user_id, nickname, target_lang, color, time.time()))


def room_mark_member_left(code: str, user_id: int):
    with conn() as c:
        c.execute("UPDATE room_members SET left_at = ? WHERE room_code = ? AND user_id = ?",
                  (time.time(), code, user_id))


def room_list_members(code: str, active_only: bool = True) -> list:
    sql = "SELECT user_id, nickname, target_lang, color, joined_at, left_at FROM room_members WHERE room_code = ?"
    if active_only:
        sql += " AND left_at IS NULL"
    sql += " ORDER BY joined_at"
    with conn() as c:
        return [dict(r) for r in c.execute(sql, (code,)).fetchall()]


def room_add_message(code: str, speaker_user_id: int, speaker_name: str,
                     src_lang: str, src: str, translations: dict):
    with conn() as c:
        c.execute("""
            INSERT INTO room_messages (room_code, speaker_user_id, speaker_name, src_lang, src, translations_json, ts)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (code, speaker_user_id, speaker_name, src_lang, src,
              json.dumps(translations, ensure_ascii=False), time.time()))


def room_list_messages(code: str) -> list:
    with conn() as c:
        rows = c.execute("""
            SELECT speaker_user_id, speaker_name, src_lang, src, translations_json, ts
            FROM room_messages WHERE room_code = ? ORDER BY ts
        """, (code,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["translations"] = json.loads(d.pop("translations_json"))
        except Exception:
            d["translations"] = {}
        out.append(d)
    return out


def rooms_for_user(user_id: int) -> list:
    """用户参与过 (含 host) 的所有房间, 按时间倒序"""
    with conn() as c:
        rows = c.execute("""
            SELECT DISTINCT r.code, r.name, r.host_user_id, r.created_at, r.closed_at,
                   (SELECT COUNT(*) FROM room_messages m WHERE m.room_code = r.code) AS msg_count,
                   (SELECT COUNT(*) FROM room_members m2 WHERE m2.room_code = r.code) AS member_count
            FROM rooms r
            LEFT JOIN room_members rm ON rm.room_code = r.code
            WHERE r.host_user_id = ? OR rm.user_id = ?
            ORDER BY r.created_at DESC
        """, (user_id, user_id)).fetchall()
        return [dict(r) for r in rows]


# ============================================================
# Direct messages (1:1, email discovery)
# ============================================================
def _dm_member_ids(c, conversation_id: int) -> list[int]:
    rows = c.execute(
        "SELECT user_id FROM dm_members WHERE conversation_id = ? ORDER BY user_id",
        (conversation_id,),
    ).fetchall()
    return [r["user_id"] for r in rows]


def dm_is_member(conversation_id: int, user_id: int) -> bool:
    with conn() as c:
        row = c.execute(
            "SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?",
            (conversation_id, user_id),
        ).fetchone()
        return bool(row)


def dm_conversation_member_ids(conversation_id: int) -> list[int]:
    with conn() as c:
        return _dm_member_ids(c, conversation_id)


def _dm_require_member(c, conversation_id: int, user_id: int):
    row = c.execute(
        "SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?",
        (conversation_id, user_id),
    ).fetchone()
    if not row:
        raise PermissionError("No tienes acceso a esta conversación")


def _dm_participant(c, conversation_id: int, current_user_id: int) -> Optional[dict]:
    row = c.execute("""
        SELECT u.id, u.email, u.nickname, u.native_lang
        FROM dm_members dm
        JOIN users u ON u.id = dm.user_id
        WHERE dm.conversation_id = ? AND dm.user_id != ?
        ORDER BY u.id
        LIMIT 1
    """, (conversation_id, current_user_id)).fetchone()
    return dict(row) if row else None


def _dm_message_dict(row) -> dict:
    d = dict(row)
    d["is_voice"] = d.get("kind") == "voice"
    raw_tj = d.get("translations_json") or "{}"
    try:
        d["translations_json"] = json.loads(raw_tj) if isinstance(raw_tj, str) else raw_tj
    except Exception:
        d["translations_json"] = {}
    if "image_url" not in d:
        d["image_url"] = None
    if "reply_to_id" not in d:
        d["reply_to_id"] = None
    return d


def dm_create_or_get_conversation(current_user_id: int, participant_email: str) -> dict:
    email = (participant_email or "").strip().lower()
    if not email:
        raise LookupError("Usuario no encontrado")
    with conn() as c:
        current = c.execute(
            "SELECT id, email, nickname FROM users WHERE id = ?",
            (current_user_id,),
        ).fetchone()
        if not current:
            raise PermissionError("Sesión inválida")
        participant = c.execute(
            "SELECT id, email, nickname FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        if not participant:
            raise LookupError("Usuario no encontrado")
        if participant["id"] == current_user_id:
            raise ValueError("No puedes iniciar un chat contigo mismo")

        existing = c.execute("""
            SELECT a.conversation_id
            FROM dm_members a
            JOIN dm_members b ON b.conversation_id = a.conversation_id
            WHERE a.user_id = ? AND b.user_id = ?
            LIMIT 1
        """, (current_user_id, participant["id"])).fetchone()
        if existing:
            conv_id = existing["conversation_id"]
        else:
            now = time.time()
            cur = c.execute(
                "INSERT INTO dm_conversations (created_at, updated_at) VALUES (?, ?)",
                (now, now),
            )
            conv_id = cur.lastrowid
            c.execute(
                "INSERT INTO dm_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)",
                (conv_id, current_user_id, now),
            )
            c.execute(
                "INSERT INTO dm_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)",
                (conv_id, participant["id"], now),
            )

        conv = c.execute(
            "SELECT id, created_at, updated_at FROM dm_conversations WHERE id = ?",
            (conv_id,),
        ).fetchone()
        return {
            **dict(conv),
            "participant": {
                "id": participant["id"],
                "email": participant["email"],
                "nickname": participant["nickname"],
            },
        }


def dm_list_conversations(user_id: int) -> list:
    with conn() as c:
        rows = c.execute("""
            SELECT dc.id, dc.created_at, dc.updated_at,
                   COALESCE(dm.last_read_message_id, 0) AS last_read_message_id,
                   dm.target_lang AS my_target_lang
            FROM dm_conversations dc
            JOIN dm_members dm ON dm.conversation_id = dc.id
            WHERE dm.user_id = ?
            ORDER BY dc.updated_at DESC, dc.id DESC
        """, (user_id,)).fetchall()
        out = []
        for r in rows:
            last = c.execute("""
                SELECT id, conversation_id, sender_user_id, kind, body,
                       voice_path, voice_mime, voice_duration_ms, voice_size_bytes,
                       translations_json, transcript, created_at, deleted_at
                FROM dm_messages
                WHERE conversation_id = ? AND deleted_at IS NULL
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            """, (r["id"],)).fetchone()
            unread = c.execute("""
                SELECT COUNT(*) AS n FROM dm_messages
                WHERE conversation_id = ?
                  AND sender_user_id != ?
                  AND id > ?
                  AND deleted_at IS NULL
            """, (r["id"], user_id, r["last_read_message_id"] or 0)).fetchone()["n"]
            out.append({
                "id": r["id"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "my_target_lang": r["my_target_lang"] or "en",
                "participant": _dm_participant(c, r["id"], user_id),
                "last_message": _dm_message_dict(last) if last else None,
                "unread_count": unread,
            })
        return out


def dm_list_messages(conversation_id: int, user_id: int, limit: int = 100) -> list:
    with conn() as c:
        _dm_require_member(c, conversation_id, user_id)
        rows = c.execute("""
            SELECT id, conversation_id, sender_user_id, kind, body,
                   voice_path, voice_mime, voice_duration_ms, voice_size_bytes,
                   translations_json, transcript, image_url, reply_to_id, created_at, deleted_at
            FROM dm_messages
            WHERE conversation_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        """, (conversation_id, max(1, min(int(limit or 100), 200)))).fetchall()
        messages = [_dm_message_dict(r) for r in reversed(rows)]
        for m in messages:
            if m.get("reply_to_id"):
                m["reply_preview"] = dm_get_reply_preview(m["reply_to_id"])
            else:
                m["reply_preview"] = None
        return messages


def dm_add_text_message(conversation_id: int, sender_user_id: int, body: str,
                        translations_json: dict | None = None,
                        reply_to_id: int | None = None) -> dict:
    text = (body or "").strip()
    if not text:
        raise ValueError("El mensaje está vacío")
    if len(text) > 4000:
        raise ValueError("El mensaje es demasiado largo")
    tj = json.dumps(translations_json or {}, ensure_ascii=False)
    with conn() as c:
        _dm_require_member(c, conversation_id, sender_user_id)
        now = time.time()
        cur = c.execute("""
            INSERT INTO dm_messages (conversation_id, sender_user_id, kind, body, translations_json, reply_to_id, created_at)
            VALUES (?, ?, 'text', ?, ?, ?, ?)
        """, (conversation_id, sender_user_id, text, tj, reply_to_id, now))
        c.execute(
            "UPDATE dm_conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )
        row = c.execute("""
            SELECT id, conversation_id, sender_user_id, kind, body,
                   voice_path, voice_mime, voice_duration_ms, voice_size_bytes,
                   translations_json, transcript, image_url, reply_to_id, created_at, deleted_at
            FROM dm_messages WHERE id = ?
        """, (cur.lastrowid,)).fetchone()
        return _dm_message_dict(row)


def dm_add_voice_message(conversation_id: int, sender_user_id: int, path: str,
                         mime: str, duration_ms: int, size_bytes: int,
                         transcript: str | None = None,
                         translations_json: dict | None = None) -> dict:
    if not path or not mime:
        raise ValueError("Nota de voz inválida")
    tj = json.dumps(translations_json or {}, ensure_ascii=False)
    with conn() as c:
        _dm_require_member(c, conversation_id, sender_user_id)
        now = time.time()
        cur = c.execute("""
            INSERT INTO dm_messages (
                conversation_id, sender_user_id, kind, voice_path, voice_mime,
                voice_duration_ms, voice_size_bytes, transcript, translations_json, created_at
            )
            VALUES (?, ?, 'voice', ?, ?, ?, ?, ?, ?, ?)
        """, (conversation_id, sender_user_id, path, mime, duration_ms, size_bytes,
              transcript, tj, now))
        c.execute(
            "UPDATE dm_conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )
        row = c.execute("""
            SELECT id, conversation_id, sender_user_id, kind, body,
                   voice_path, voice_mime, voice_duration_ms, voice_size_bytes,
                   translations_json, transcript, image_url, reply_to_id, created_at, deleted_at
            FROM dm_messages WHERE id = ?
        """, (cur.lastrowid,)).fetchone()
        return _dm_message_dict(row)


def dm_add_image_message(conversation_id: int, sender_user_id: int, image_url: str,
                         reply_to_id: int | None = None,
                         translations_json: dict | None = None) -> dict:
    if not image_url:
        raise ValueError("URL de imagen inválida")
    tj = json.dumps(translations_json or {}, ensure_ascii=False)
    with conn() as c:
        _dm_require_member(c, conversation_id, sender_user_id)
        now = time.time()
        cur = c.execute("""
            INSERT INTO dm_messages (conversation_id, sender_user_id, kind, image_url, reply_to_id, translations_json, created_at)
            VALUES (?, ?, 'image', ?, ?, ?, ?)
        """, (conversation_id, sender_user_id, image_url, reply_to_id, tj, now))
        c.execute(
            "UPDATE dm_conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )
        row = c.execute("""
            SELECT id, conversation_id, sender_user_id, kind, body,
                   voice_path, voice_mime, voice_duration_ms, voice_size_bytes,
                   translations_json, transcript, image_url, reply_to_id, created_at, deleted_at
            FROM dm_messages WHERE id = ?
        """, (cur.lastrowid,)).fetchone()
        return _dm_message_dict(row)


def dm_get_reply_preview(message_id: int) -> Optional[dict]:
    if not message_id:
        return None
    with conn() as c:
        row = c.execute("""
            SELECT m.id, m.sender_user_id, m.kind, m.body, m.image_url, m.transcript,
                   u.nickname AS sender_name
            FROM dm_messages m
            JOIN users u ON u.id = m.sender_user_id
            WHERE m.id = ? AND m.deleted_at IS NULL
        """, (message_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        preview = d.get("body") or d.get("transcript") or ""
        if d.get("kind") == "image":
            preview = "📷 Imagen"
        elif d.get("kind") == "voice":
            preview = "🎙 Nota de voz"
        return {
            "id": d["id"],
            "sender_user_id": d["sender_user_id"],
            "sender_name": d.get("sender_name") or "",
            "kind": d["kind"],
            "body": preview[:100],
            "image_url": d.get("image_url"),
        }


def dm_mark_read(conversation_id: int, user_id: int, message_id: int):
    with conn() as c:
        _dm_require_member(c, conversation_id, user_id)
        c.execute("""
            UPDATE dm_members
            SET last_read_message_id = MAX(COALESCE(last_read_message_id, 0), ?)
            WHERE conversation_id = ? AND user_id = ?
        """, (int(message_id or 0), conversation_id, user_id))


def dm_get_message(message_id: int, user_id: int) -> Optional[dict]:
    with conn() as c:
        row = c.execute("""
            SELECT m.id, m.conversation_id, m.sender_user_id, m.kind, m.body,
                   m.voice_path, m.voice_mime, m.voice_duration_ms, m.voice_size_bytes,
                   m.translations_json, m.transcript, m.created_at, m.deleted_at
            FROM dm_messages m
            JOIN dm_members dm ON dm.conversation_id = m.conversation_id
            WHERE m.id = ? AND dm.user_id = ? AND m.deleted_at IS NULL
        """, (message_id, user_id)).fetchone()
        return _dm_message_dict(row) if row else None


def dm_member_target_langs(conversation_id: int) -> list[dict]:
    with conn() as c:
        rows = c.execute("""
            SELECT dm.user_id, dm.target_lang, u.native_lang
            FROM dm_members dm
            JOIN users u ON u.id = dm.user_id
            WHERE dm.conversation_id = ?
        """, (conversation_id,)).fetchall()
        return [dict(r) for r in rows]


def dm_set_member_target_lang(conversation_id: int, user_id: int, target_lang: str):
    lang = (target_lang or "en").strip().lower()
    with conn() as c:
        c.execute("""
            UPDATE dm_members SET target_lang = ? WHERE conversation_id = ? AND user_id = ?
        """, (lang, conversation_id, user_id))


# ============================================================
# Web Push subscriptions
# ============================================================
def _normalize_push_subscription(subscription: dict) -> dict:
    if not isinstance(subscription, dict):
        raise ValueError("Suscripción push inválida")
    endpoint = (subscription.get("endpoint") or "").strip()
    keys = subscription.get("keys") or {}
    p256dh = (keys.get("p256dh") or "").strip() if isinstance(keys, dict) else ""
    auth = (keys.get("auth") or "").strip() if isinstance(keys, dict) else ""
    if not endpoint or not p256dh or not auth:
        raise ValueError("Suscripción push incompleta")
    if len(endpoint) > 2048 or len(p256dh) > 512 or len(auth) > 256:
        raise ValueError("Suscripción push demasiado grande")
    return {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}


def push_save_subscription(user_id: int, subscription: dict) -> dict:
    normalized = _normalize_push_subscription(subscription)
    now = time.time()
    with conn() as c:
        c.execute("""
            INSERT INTO push_subscriptions (endpoint, user_id, subscription_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                user_id = excluded.user_id,
                subscription_json = excluded.subscription_json,
                updated_at = excluded.updated_at
        """, (
            normalized["endpoint"],
            user_id,
            json.dumps(normalized, ensure_ascii=False),
            now,
            now,
        ))
    return normalized


def push_delete_subscription(user_id: int, endpoint: str):
    with conn() as c:
        c.execute(
            "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
            (user_id, endpoint),
        )


def push_list_subscriptions(user_id: int) -> list:
    with conn() as c:
        rows = c.execute("""
            SELECT endpoint, subscription_json, updated_at
            FROM push_subscriptions
            WHERE user_id = ?
            ORDER BY updated_at DESC
        """, (user_id,)).fetchall()
    out = []
    for r in rows:
        try:
            sub = json.loads(r["subscription_json"])
        except Exception:
            continue
        out.append({**sub, "updated_at": r["updated_at"]})
    return out


def push_list_conversation_recipients(conversation_id: int, sender_user_id: int) -> list:
    with conn() as c:
        rows = c.execute("""
            SELECT ps.user_id, ps.subscription_json
            FROM push_subscriptions ps
            JOIN dm_members dm ON dm.user_id = ps.user_id
            WHERE dm.conversation_id = ? AND ps.user_id != ?
            ORDER BY ps.updated_at DESC
        """, (conversation_id, sender_user_id)).fetchall()
    out = []
    for r in rows:
        try:
            sub = json.loads(r["subscription_json"])
        except Exception:
            continue
        out.append({"user_id": r["user_id"], "subscription": sub})
    return out


# ============================================================
# Stats / analytics 聚合查询 (admin dashboard 用)
# ============================================================
def count_recordings_by_user(user_id: int) -> int:
    """单用户已创建的 recording 数 (试用次数限制用)"""
    with conn() as c:
        row = c.execute(
            "SELECT COUNT(*) AS n FROM recordings WHERE user_id = ?", (user_id,)
        ).fetchone()
        return row["n"] if row else 0


def stats_overview() -> dict:
    """全站概览: 用户 / 录音 / 房间各项 count + 最近 7/30 天增量"""
    now = time.time()
    d7 = now - 7 * 86400
    d30 = now - 30 * 86400
    with conn() as c:
        users_total = c.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        users_7d = c.execute(
            "SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", (d7,)
        ).fetchone()["n"]
        users_30d = c.execute(
            "SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", (d30,)
        ).fetchone()["n"]
        rec_total = c.execute("SELECT COUNT(*) AS n FROM recordings").fetchone()["n"]
        rec_today = c.execute(
            "SELECT COUNT(*) AS n FROM recordings WHERE created_at >= ?", (now - 86400,)
        ).fetchone()["n"]
        rec_7d = c.execute(
            "SELECT COUNT(*) AS n FROM recordings WHERE created_at >= ?", (d7,)
        ).fetchone()["n"]
        rec_30d = c.execute(
            "SELECT COUNT(*) AS n FROM recordings WHERE created_at >= ?", (d30,)
        ).fetchone()["n"]
        rooms_total = c.execute("SELECT COUNT(*) AS n FROM rooms").fetchone()["n"]
        rooms_active = c.execute(
            "SELECT COUNT(*) AS n FROM rooms WHERE closed_at IS NULL"
        ).fetchone()["n"]
        room_msgs = c.execute("SELECT COUNT(*) AS n FROM room_messages").fetchone()["n"]
        entries_total = 0
        for r in c.execute("SELECT entries_json FROM recordings").fetchall():
            try:
                entries_total += len(json.loads(r["entries_json"] or "[]"))
            except Exception:
                pass
        active_7d = c.execute(
            "SELECT COUNT(DISTINCT user_id) AS n FROM recordings WHERE created_at >= ?",
            (d7,),
        ).fetchone()["n"]
        active_30d = c.execute(
            "SELECT COUNT(DISTINCT user_id) AS n FROM recordings WHERE created_at >= ?",
            (d30,),
        ).fetchone()["n"]
    return {
        "users": {"total": users_total, "new_7d": users_7d, "new_30d": users_30d,
                  "active_7d": active_7d, "active_30d": active_30d},
        "recordings": {"total": rec_total, "today": rec_today,
                       "last_7d": rec_7d, "last_30d": rec_30d,
                       "entries_total": entries_total},
        "rooms": {"total": rooms_total, "active": rooms_active, "messages": room_msgs},
        "generated_at": now,
    }


def daily_recordings(days: int = 7) -> list:
    """过去 N 天每日 recording 创建数, 返回 [{date: 'MM-DD', count: N}, ...]"""
    out = []
    now = time.time()
    with conn() as c:
        for i in range(days - 1, -1, -1):
            day_start = now - (i + 1) * 86400
            day_end = now - i * 86400
            n = c.execute(
                "SELECT COUNT(*) AS n FROM recordings WHERE created_at >= ? AND created_at < ?",
                (day_start, day_end),
            ).fetchone()["n"]
            date = datetime.fromtimestamp(day_end - 1).strftime("%m-%d")
            out.append({"date": date, "count": n})
    return out


def top_users_by_recordings(limit: int = 10) -> list:
    """录音数 top N 用户 (含 last_active = 最近一条 recording 时间)"""
    with conn() as c:
        rows = c.execute("""
            SELECT u.id, u.email, u.nickname,
                   COUNT(r.id) AS rec_count,
                   MAX(r.created_at) AS last_active
            FROM users u
            LEFT JOIN recordings r ON r.user_id = u.id
            GROUP BY u.id
            ORDER BY rec_count DESC, last_active DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


init()
