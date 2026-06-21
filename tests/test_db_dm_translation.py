import sys
import os
import json
import tempfile
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    db_file = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    monkeypatch.setattr(db, "DB_PATH", str(db_file))
    db.init()
    yield


def _make_user(email: str, nickname: str = "test") -> dict:
    u = db.create_user(email, "password123", nickname)
    assert u is not None
    return u


def _make_conversation(user_a: dict, user_b: dict) -> dict:
    return db.dm_create_or_get_conversation(user_a["id"], user_b["email"])


class TestDmMemberTargetLang:
    def test_default_target_lang_is_en(self):
        a = _make_user("a@test.com", "Alice")
        b = _make_user("b@test.com", "Bob")
        conv = _make_conversation(a, b)
        langs = db.dm_member_target_langs(conv["id"])
        for member in langs:
            assert member["target_lang"] == "en"

    def test_set_target_lang(self):
        a = _make_user("a2@test.com", "Alice")
        b = _make_user("b2@test.com", "Bob")
        conv = _make_conversation(a, b)
        db.dm_set_member_target_lang(conv["id"], a["id"], "ja")
        langs = db.dm_member_target_langs(conv["id"])
        a_entry = next(m for m in langs if m["user_id"] == a["id"])
        assert a_entry["target_lang"] == "ja"

    def test_set_target_lang_normalizes_lowercase(self):
        a = _make_user("a3@test.com", "Alice")
        b = _make_user("b3@test.com", "Bob")
        conv = _make_conversation(a, b)
        db.dm_set_member_target_lang(conv["id"], a["id"], "JA")
        langs = db.dm_member_target_langs(conv["id"])
        a_entry = next(m for m in langs if m["user_id"] == a["id"])
        assert a_entry["target_lang"] == "ja"

    def test_each_member_has_independent_lang(self):
        a = _make_user("a4@test.com", "Alice")
        b = _make_user("b4@test.com", "Bob")
        conv = _make_conversation(a, b)
        db.dm_set_member_target_lang(conv["id"], a["id"], "ja")
        db.dm_set_member_target_lang(conv["id"], b["id"], "es")
        langs = {m["user_id"]: m["target_lang"] for m in db.dm_member_target_langs(conv["id"])}
        assert langs[a["id"]] == "ja"
        assert langs[b["id"]] == "es"


class TestDmAddTextMessageWithTranslation:
    def test_stores_translations_json(self):
        a = _make_user("c1@test.com", "Alice")
        b = _make_user("c2@test.com", "Bob")
        conv = _make_conversation(a, b)
        translations = {"ja": "こんにちは世界", "ru": "Привет мир"}
        msg = db.dm_add_text_message(conv["id"], a["id"], "Hola mundo", translations)
        assert msg["translations_json"] == translations

    def test_empty_translations_stores_empty_dict(self):
        a = _make_user("c3@test.com", "Alice")
        b = _make_user("c4@test.com", "Bob")
        conv = _make_conversation(a, b)
        msg = db.dm_add_text_message(conv["id"], a["id"], "Hola", None)
        assert msg["translations_json"] == {}

    def test_translations_json_roundtrip(self):
        a = _make_user("c5@test.com", "Alice")
        b = _make_user("c6@test.com", "Bob")
        conv = _make_conversation(a, b)
        translations = {"ja": "やばい！", "ru": "Блин!"}
        msg = db.dm_add_text_message(conv["id"], a["id"], "coño!", translations)
        fetched = db.dm_get_message(msg["id"], a["id"])
        assert fetched is not None
        assert fetched["translations_json"]["ja"] == "やばい！"
        assert fetched["translations_json"]["ru"] == "Блин!"

    def test_message_body_stored_correctly(self):
        a = _make_user("c7@test.com", "Alice")
        b = _make_user("c8@test.com", "Bob")
        conv = _make_conversation(a, b)
        msg = db.dm_add_text_message(conv["id"], a["id"], "  chévere pana!  ", {})
        assert msg["body"] == "chévere pana!"

    def test_empty_body_raises(self):
        a = _make_user("c9@test.com", "Alice")
        b = _make_user("c10@test.com", "Bob")
        conv = _make_conversation(a, b)
        with pytest.raises(ValueError):
            db.dm_add_text_message(conv["id"], a["id"], "   ", {})

    def test_body_too_long_raises(self):
        a = _make_user("c11@test.com", "Alice")
        b = _make_user("c12@test.com", "Bob")
        conv = _make_conversation(a, b)
        with pytest.raises(ValueError):
            db.dm_add_text_message(conv["id"], a["id"], "x" * 4001, {})


class TestDmAddVoiceMessageWithTranscript:
    def test_stores_transcript_and_translations(self, tmp_path):
        a = _make_user("d1@test.com", "Alice")
        b = _make_user("d2@test.com", "Bob")
        conv = _make_conversation(a, b)
        fake_audio = tmp_path / "note.webm"
        fake_audio.write_bytes(b"\x00" * 100)
        translations = {"ru": "Привет", "ja": "こんにちは"}
        msg = db.dm_add_voice_message(
            conversation_id=conv["id"],
            sender_user_id=a["id"],
            path=str(fake_audio),
            mime="audio/webm",
            duration_ms=3000,
            size_bytes=100,
            transcript="Hola a todos",
            translations_json=translations,
        )
        assert msg["transcript"] == "Hola a todos"
        assert msg["translations_json"]["ru"] == "Привет"
        assert msg["translations_json"]["ja"] == "こんにちは"

    def test_voice_message_no_transcript(self, tmp_path):
        a = _make_user("d3@test.com", "Alice")
        b = _make_user("d4@test.com", "Bob")
        conv = _make_conversation(a, b)
        fake_audio = tmp_path / "note2.webm"
        fake_audio.write_bytes(b"\x00" * 50)
        msg = db.dm_add_voice_message(
            conversation_id=conv["id"],
            sender_user_id=a["id"],
            path=str(fake_audio),
            mime="audio/webm",
            duration_ms=1000,
            size_bytes=50,
            transcript=None,
            translations_json=None,
        )
        assert msg["transcript"] is None
        assert msg["translations_json"] == {}


class TestDmGetMessage:
    def test_returns_none_for_non_member(self):
        a = _make_user("e1@test.com", "Alice")
        b = _make_user("e2@test.com", "Bob")
        outsider = _make_user("e3@test.com", "Outsider")
        conv = _make_conversation(a, b)
        msg = db.dm_add_text_message(conv["id"], a["id"], "mensaje privado", {})
        result = db.dm_get_message(msg["id"], outsider["id"])
        assert result is None

    def test_returns_message_for_member(self):
        a = _make_user("e4@test.com", "Alice")
        b = _make_user("e5@test.com", "Bob")
        conv = _make_conversation(a, b)
        msg = db.dm_add_text_message(conv["id"], a["id"], "visible para B", {})
        result = db.dm_get_message(msg["id"], b["id"])
        assert result is not None
        assert result["body"] == "visible para B"

    def test_translations_json_is_dict_not_string(self):
        a = _make_user("e6@test.com", "Alice")
        b = _make_user("e7@test.com", "Bob")
        conv = _make_conversation(a, b)
        msg = db.dm_add_text_message(conv["id"], a["id"], "test", {"ja": "テスト"})
        result = db.dm_get_message(msg["id"], a["id"])
        assert isinstance(result["translations_json"], dict)
        assert result["translations_json"]["ja"] == "テスト"


class TestDmIsMember:
    def test_members_are_members(self):
        a = _make_user("f1@test.com", "Alice")
        b = _make_user("f2@test.com", "Bob")
        conv = _make_conversation(a, b)
        assert db.dm_is_member(conv["id"], a["id"]) is True
        assert db.dm_is_member(conv["id"], b["id"]) is True

    def test_non_member_is_not_member(self):
        a = _make_user("f3@test.com", "Alice")
        b = _make_user("f4@test.com", "Bob")
        outsider = _make_user("f5@test.com", "Outsider")
        conv = _make_conversation(a, b)
        assert db.dm_is_member(conv["id"], outsider["id"]) is False


class TestDmCreateOrGetConversation:
    def test_creates_conversation(self):
        a = _make_user("g1@test.com", "Alice")
        b = _make_user("g2@test.com", "Bob")
        conv = _make_conversation(a, b)
        assert conv["id"] > 0

    def test_idempotent_same_conversation(self):
        a = _make_user("g3@test.com", "Alice")
        b = _make_user("g4@test.com", "Bob")
        conv1 = _make_conversation(a, b)
        conv2 = _make_conversation(a, b)
        assert conv1["id"] == conv2["id"]

    def test_symmetric_same_conversation(self):
        a = _make_user("g5@test.com", "Alice")
        b = _make_user("g6@test.com", "Bob")
        conv_ab = _make_conversation(a, b)
        conv_ba = db.dm_create_or_get_conversation(b["id"], a["email"])
        assert conv_ab["id"] == conv_ba["id"]
