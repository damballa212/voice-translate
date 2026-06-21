import sys
import os
import json
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from text_translator import (
    _parse_response,
    _build_system_prompt,
    _tone_rule,
    _lang_full,
    translate_text,
    translate_for_members,
)


class TestLangFull:
    def test_known_lang(self):
        assert _lang_full("es") == "Spanish"
        assert _lang_full("ja") == "Japanese"
        assert _lang_full("ru") == "Russian"
        assert _lang_full("en") == "English"

    def test_unknown_lang_returns_code(self):
        assert _lang_full("xx") == "xx"

    def test_case_insensitive(self):
        assert _lang_full("ES") == "Spanish"
        assert _lang_full("JA") == "Japanese"


class TestParseResponse:
    def test_valid_json(self):
        raw = '{"translated": "Hola mundo", "source_lang": "en"}'
        result = _parse_response(raw, "fallback")
        assert result["translated"] == "Hola mundo"
        assert result["source_lang"] == "en"

    def test_json_with_markdown_fences(self):
        raw = '```json\n{"translated": "Hola", "source_lang": "en"}\n```'
        result = _parse_response(raw, "fallback")
        assert result["translated"] == "Hola"
        assert result["source_lang"] == "en"

    def test_json_with_plain_fences(self):
        raw = '```\n{"translated": "Hola", "source_lang": "en"}\n```'
        result = _parse_response(raw, "fallback")
        assert result["translated"] == "Hola"

    def test_invalid_json_returns_raw(self):
        raw = "Hola mundo sin JSON"
        result = _parse_response(raw, "fallback")
        assert result["translated"] == "Hola mundo sin JSON"
        assert result["source_lang"] == "unknown"

    def test_empty_translated_field_uses_fallback_text(self):
        raw = '{"translated": "", "source_lang": "es"}'
        result = _parse_response(raw, "original text")
        assert result["translated"] == "original text"

    def test_whitespace_trimmed(self):
        raw = '  {"translated": "  Hola  ", "source_lang": "es"}  '
        result = _parse_response(raw, "fallback")
        assert result["translated"] == "Hola"

    def test_missing_source_lang_defaults_unknown(self):
        raw = '{"translated": "Hola"}'
        result = _parse_response(raw, "fallback")
        assert result["source_lang"] == "unknown"


class TestBuildSystemPrompt:
    def test_contains_target_lang(self):
        prompt = _build_system_prompt("ja")
        assert "Japanese" in prompt
        assert "ja" in prompt

    def test_contains_base_rules(self):
        prompt = _build_system_prompt("ru")
        assert "translation machine" in prompt
        assert "JSON" in prompt

    def test_es_ja_includes_slang(self):
        prompt = _build_system_prompt("ja", source_hint="es")
        assert "coño" in prompt
        assert "chamo" in prompt
        assert "めっちゃ" in prompt

    def test_es_ru_includes_slang(self):
        prompt = _build_system_prompt("ru", source_hint="es")
        assert "coño" in prompt
        assert "блин" in prompt

    def test_ja_es_includes_kansai(self):
        prompt = _build_system_prompt("es", source_hint="ja")
        assert "ほんま" in prompt
        assert "あかん" in prompt

    def test_ru_es_includes_russian_slang(self):
        prompt = _build_system_prompt("es", source_hint="ru")
        assert "офигеть" in prompt

    def test_no_source_hint_no_slang(self):
        prompt = _build_system_prompt("en")
        assert "coño" not in prompt

    def test_output_format_instruction(self):
        prompt = _build_system_prompt("es")
        assert '"translated"' in prompt
        assert '"source_lang"' in prompt


class TestToneRule:
    def test_es_to_ja(self):
        rule = _tone_rule("es", "ja")
        assert "Venezuelan Spanish" in rule
        assert "Japanese" in rule

    def test_ja_to_es(self):
        rule = _tone_rule("ja", "es")
        assert "Venezuelan Spanish" in rule

    def test_no_es_pair_empty(self):
        rule = _tone_rule("ja", "ru")
        assert rule == ""

    def test_en_es_pair(self):
        rule = _tone_rule("en", "es")
        assert "Venezuelan Spanish" in rule


class TestTranslateText:
    def _make_mock_response(self, translated: str, source_lang: str = "es"):
        mock_msg = MagicMock()
        mock_msg.content = json.dumps({"translated": translated, "source_lang": source_lang})
        mock_choice = MagicMock()
        mock_choice.message = mock_msg
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        return mock_response

    @pytest.mark.asyncio
    async def test_basic_translation(self):
        mock_response = self._make_mock_response("こんにちは世界")
        with patch("text_translator.acompletion", new_callable=AsyncMock, return_value=mock_response):
            result = await translate_text("Hola mundo", "ja")
        assert result["translated"] == "こんにちは世界"
        assert result["source_lang"] == "es"

    @pytest.mark.asyncio
    async def test_empty_text_returns_as_is(self):
        result = await translate_text("", "ja")
        assert result["translated"] == ""

    @pytest.mark.asyncio
    async def test_whitespace_only_returns_as_is(self):
        result = await translate_text("   ", "ja")
        assert result["translated"] == "   "

    @pytest.mark.asyncio
    async def test_sender_name_passed(self):
        mock_response = self._make_mock_response("Привет")
        calls = []
        async def fake_acompletion(**kwargs):
            calls.append(kwargs)
            return mock_response
        with patch("text_translator.acompletion", side_effect=fake_acompletion):
            await translate_text("Hola", "ru", sender_name="Marlon")
        messages = calls[0]["messages"]
        found = any("Marlon" in (m.get("content") or "") for m in messages)
        assert found

    @pytest.mark.asyncio
    async def test_fallback_model_on_first_failure(self):
        mock_response = self._make_mock_response("Fallback result")
        call_count = [0]
        async def fake_acompletion(**kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("Primary model unavailable")
            return mock_response
        with patch("text_translator.TRANSLATION_FALLBACK_MODEL", "openai/gpt-4o-mini"):
            with patch("text_translator.acompletion", side_effect=fake_acompletion):
                result = await translate_text("Hola", "ru")
        assert result["translated"] == "Fallback result"
        assert call_count[0] == 2

    @pytest.mark.asyncio
    async def test_all_models_fail_returns_original(self):
        async def always_fail(**kwargs):
            raise RuntimeError("Service unavailable")
        with patch("text_translator.acompletion", side_effect=always_fail):
            result = await translate_text("Hola mundo", "ja")
        assert result["translated"] == "Hola mundo"
        assert result["source_lang"] == "unknown"


class TestTranslateForMembers:
    def _make_mock_response(self, translated: str, source_lang: str = "es"):
        mock_msg = MagicMock()
        mock_msg.content = json.dumps({"translated": translated, "source_lang": source_lang})
        mock_choice = MagicMock()
        mock_choice.message = mock_msg
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        return mock_response

    @pytest.mark.asyncio
    async def test_single_lang(self):
        mock_response = self._make_mock_response("Привет мир")
        with patch("text_translator.acompletion", new_callable=AsyncMock, return_value=mock_response):
            result = await translate_for_members("Hola mundo", ["ru"])
        assert "ru" in result
        assert result["ru"] == "Привет мир"

    @pytest.mark.asyncio
    async def test_multiple_langs_parallel(self):
        responses = {
            "ja": self._make_mock_response("こんにちは世界"),
            "ru": self._make_mock_response("Привет мир"),
        }
        call_idx = [0]
        lang_responses = [responses["ja"], responses["ru"]]
        async def rotating_response(**kwargs):
            idx = call_idx[0] % len(lang_responses)
            call_idx[0] += 1
            return lang_responses[idx]
        with patch("text_translator.acompletion", side_effect=rotating_response):
            result = await translate_for_members("Hola mundo", ["ja", "ru"])
        assert set(result.keys()) == {"ja", "ru"}

    @pytest.mark.asyncio
    async def test_deduplicates_langs(self):
        mock_response = self._make_mock_response("result")
        call_count = [0]
        async def counting(**kwargs):
            call_count[0] += 1
            return mock_response
        with patch("text_translator.acompletion", side_effect=counting):
            result = await translate_for_members("Hola", ["ja", "ja", "ja"])
        assert call_count[0] == 1
        assert "ja" in result

    @pytest.mark.asyncio
    async def test_partial_failure_returns_original_for_failed_lang(self):
        call_count = [0]
        async def partial_fail(**kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("Failed")
            mock_msg = MagicMock()
            mock_msg.content = json.dumps({"translated": "Привет", "source_lang": "es"})
            mock_choice = MagicMock()
            mock_choice.message = mock_msg
            mock_response = MagicMock()
            mock_response.choices = [mock_choice]
            return mock_response
        with patch("text_translator.acompletion", side_effect=partial_fail):
            with patch("text_translator.TRANSLATION_FALLBACK_MODEL", ""):
                with patch("text_translator.TRANSLATION_FALLBACK2_MODEL", ""):
                    result = await translate_for_members("Hola", ["ja", "ru"])
        langs = set(result.keys())
        assert langs == {"ja", "ru"}
        failed_lang = [k for k, v in result.items() if v == "Hola"]
        assert len(failed_lang) == 1
