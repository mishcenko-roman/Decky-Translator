# providers/ct2_translate.py
# CTranslate2 + NLLB-200 translation provider

import json
import logging
import os
import re
import subprocess
import threading
import unicodedata
from typing import List, Optional

from .base import TranslationProvider, ProviderType
from .nllb_downloader import NLLB_LANG_MAP, NLLBDownloader
from . import python_runtime

logger = logging.getLogger(__name__)

WORKER_TIMEOUT = 120
WORKER_STARTUP_TIMEOUT = 30

# UI strings NLLB sometimes mistranslates things ("STEAM MENU" -> "СТОМ МЕНУ")
_SKIP_TRANSLATE_TOKENS = {
    "steam menu", "quick menu", "quick access", "main menu",
    "b back", "a select", "a confirm", "x confirm", "y menu",
    "escape back",
    # Controller letters / shortcuts
    "a", "b", "x", "y",
    "l1", "l2", "l3", "l4", "l5",
    "r1", "r2", "r3", "r4", "r5",
    "lb", "rb", "lt", "rt",
}

_SHORT_TEXT_CHAR_LIMIT = 20

# NLLB was trained on single sentences and the decoder is O(n^2) in length,
# so splitting long inputs is a real speed win. In-batch dedup covers the
# extra fragments.
_SPLIT_SENTENCES_CHAR_LIMIT = 60

# End punctuation + whitespace (ASCII and CJK). Candidates shorter than
# 5 chars are rejected so "Mr." and "e.g." don't get split.
_SENTENCE_END_RE = re.compile(r"[.!?。！？]+[\s　]+")

# Comma/semicolon fallback for long prose without periods. Only runs when
# a sentence is still above _CLAUSE_SPLIT_MIN_CHARS after the first pass.
_CLAUSE_BREAK_RE = re.compile(r"[,;、，；][\s　]+")
_CLAUSE_SPLIT_MIN_CHARS = 80


_ZERO_WIDTH_CHARS = "\u200b\u200c\u200d\u200e\u200f\ufeff"

_PUNCT_FOLD = {
    "‘": "'", "’": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
    "–": "-", "—": "-", "‒": "-", "−": "-",
    " ": " ", "　": " ",
}
_NORMALIZE_TABLE = str.maketrans(
    {**_PUNCT_FOLD, **{c: None for c in _ZERO_WIDTH_CHARS}}
)


def _normalize_unicode(src: str) -> str:
    return unicodedata.normalize("NFKC", src).translate(_NORMALIZE_TABLE)


def _is_only_punct_or_digits(s: str) -> bool:
    return all(c.isdigit() or c.isspace() or c in ".,;:!?-_()[]{}'\"" for c in s)


def _is_number_heavy(s: str) -> bool:
    """Mostly digits, at most 2 letters: "5 HP", "102", "3/10", etc"""
    alpha = sum(1 for c in s if c.isalpha())
    digit = sum(1 for c in s if c.isdigit())
    return digit > 0 and alpha <= 2


def _should_skip_translation(src: str) -> bool:
    stripped = src.strip()
    if not stripped:
        return True
    if len(stripped) > _SHORT_TEXT_CHAR_LIMIT:
        return False
    if stripped.lower() in _SKIP_TRANSLATE_TOKENS:
        return True
    if _is_only_punct_or_digits(stripped):
        return True
    if _is_number_heavy(stripped):
        return True
    return False


def _normalize_caps(src: str):
    """Lowercase short ALL-CAPS strings; NLLB handles cased text better.
    Caller re-uppercases the output."""
    stripped = src.strip()
    if (
        len(stripped) <= 30
        and stripped.isupper()
        and any(c.isalpha() for c in stripped)
    ):
        return stripped.lower(), True
    return src, False


def _split_sentences(text: str) -> List[str]:
    text = text.strip()
    if not text:
        return []
    sentences = []
    start = 0
    for match in _SENTENCE_END_RE.finditer(text):
        end = match.end()
        candidate = text[start:end].rstrip()
        # Drop tiny pieces so "Mr." and "e.g." don't split.
        if len(candidate) < 5:
            continue
        sentences.append(candidate)
        start = end
    if start < len(text):
        tail = text[start:].rstrip()
        if tail:
            sentences.append(tail)

    # Long fragments get a second pass on commas/semicolons.
    result = []
    for s in sentences:
        if len(s) >= _CLAUSE_SPLIT_MIN_CHARS:
            clauses = _split_on_clauses(s)
            if len(clauses) > 1:
                result.extend(clauses)
                continue
        result.append(s)
    return result


def _split_on_clauses(text: str) -> List[str]:
    clauses = []
    start = 0
    for match in _CLAUSE_BREAK_RE.finditer(text):
        end = match.end()
        candidate = text[start:end].rstrip().rstrip(",;、，；")
        if len(candidate) < 5:
            continue
        clauses.append(candidate)
        start = end
    if start < len(text):
        tail = text[start:].rstrip()
        if tail:
            clauses.append(tail)
    return clauses


class CT2TranslateProvider(TranslationProvider):
    """
    Offline translation using CTranslate2 + NLLB-200 int8 model.
    Runs a persistent subprocess worker to avoid reloading models per request.
    """

    SUPPORTED_LANGUAGES = list(NLLB_LANG_MAP.keys())

    def __init__(self, model_manager: NLLBDownloader, plugin_dir: str = ""):
        self._model_manager = model_manager
        self._plugin_dir = plugin_dir or os.environ.get(
            "DECKY_PLUGIN_DIR",
            "/home/deck/homebrew/plugins/decky-translator"
        )
        self._worker_process = None
        self._worker_lock = threading.Lock()
        self._loaded_model_dir = None
        self._python_path = None
        self._persistent_mode = False

        bin_worker = os.path.join(
            self._plugin_dir, "bin", "py_modules", "providers", "ct2_translate_worker.py"
        )
        root_worker = os.path.join(
            self._plugin_dir, "py_modules", "providers", "ct2_translate_worker.py"
        )
        self._worker_script = bin_worker if os.path.exists(bin_worker) else root_worker

        bin_py_modules = os.path.join(self._plugin_dir, "bin", "py_modules")
        root_py_modules = os.path.join(self._plugin_dir, "py_modules")
        py_paths = [p for p in [bin_py_modules, root_py_modules] if os.path.exists(p)]
        self._py_modules_path = os.pathsep.join(py_paths) if py_paths else root_py_modules

    def _find_python_interpreter(self) -> Optional[str]:
        if self._python_path:
            return self._python_path
        self._python_path = python_runtime.find_python(self._plugin_dir)
        return self._python_path

    def _ensure_worker(self) -> bool:
        with self._worker_lock:
            if self._worker_process and self._worker_process.poll() is None:
                return True

            python_path = self._find_python_interpreter()
            if not python_path:
                logger.error("CT2 translation: No Python interpreter found")
                return False

            env = os.environ.copy()
            env['PYTHONPATH'] = self._py_modules_path
            env['PYTHONNOUSERSITE'] = '1'
            env['PYTHONDONTWRITEBYTECODE'] = '1'
            env['OMP_NUM_THREADS'] = '4'
            env['MKL_NUM_THREADS'] = '4'
            if self._persistent_mode:
                env['CT2_PERSISTENT'] = '1'

            try:
                self._worker_process = subprocess.Popen(
                    [python_path, '-S', self._worker_script],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    env=env,
                    bufsize=0,
                )
                self._loaded_model_dir = None
                logger.info("CT2 translation worker started")
                return True
            except Exception as e:
                logger.error(f"Failed to start CT2 translation worker: {e}")
                self._worker_process = None
                return False

    def _send_command(self, cmd: dict, timeout: float = WORKER_TIMEOUT) -> dict:
        with self._worker_lock:
            if not self._worker_process or self._worker_process.poll() is not None:
                return {"ok": False, "error": "Worker not running"}

            try:
                line = json.dumps(cmd) + "\n"
                self._worker_process.stdin.write(line.encode('utf-8'))
                self._worker_process.stdin.flush()

                import select
                ready, _, _ = select.select(
                    [self._worker_process.stdout], [], [], timeout
                )
                if not ready:
                    return {"ok": False, "error": "Worker timed out"}

                response_line = self._worker_process.stdout.readline()
                if not response_line:
                    return {"ok": False, "error": "Worker closed unexpectedly"}

                return json.loads(response_line.decode('utf-8'))
            except BrokenPipeError:
                self._worker_process = None
                self._loaded_model_dir = None
                return {"ok": False, "error": "Worker crashed"}
            except Exception as e:
                return {"ok": False, "error": str(e)}

    def _load_model(self) -> dict:
        """Load the NLLB model in the worker. Skips if already loaded."""
        model_dir = self._model_manager.get_model_dir()
        if self._loaded_model_dir == model_dir:
            return {"ok": True}

        result = self._send_command({"cmd": "load", "model_dir": model_dir})
        if result.get("ok"):
            self._loaded_model_dir = model_dir
        else:
            self._loaded_model_dir = None
        return result

    @property
    def name(self) -> str:
        return "Offline (NLLB)"

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.CT2

    def is_available(self, source_lang: str = "auto", target_lang: str = "en") -> bool:
        if source_lang == "auto":
            return False
        return self._model_manager.is_model_downloaded()

    def get_supported_languages(self) -> List[str]:
        return self.SUPPORTED_LANGUAGES.copy()

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        results = await self.translate_batch([text], source_lang, target_lang)
        return results[0] if results else text

    async def translate_batch(
        self, texts: List[str], source_lang: str, target_lang: str
    ) -> List[str]:
        import asyncio
        return await asyncio.to_thread(
            self._translate_batch_sync, texts, source_lang, target_lang
        )

    def _translate_batch_sync(
        self, texts: List[str], source_lang: str, target_lang: str
    ) -> List[str]:
        if not texts:
            return []

        if source_lang == "auto":
            logger.error("CT2 translation does not support auto-detect")
            return texts

        src_nllb = self._model_manager.get_nllb_lang_code(source_lang)
        tgt_nllb = self._model_manager.get_nllb_lang_code(target_lang)
        if not src_nllb or not tgt_nllb:
            logger.error(f"Unsupported language: {source_lang} or {target_lang}")
            return texts

        if not self._model_manager.is_model_downloaded():
            from .base import NetworkError
            raise NetworkError("NLLB model not downloaded")

        if not self._ensure_worker():
            logger.error("Could not start CT2 translation worker")
            return texts

        load_result = self._load_model()
        if not load_result.get("ok"):
            error = load_result.get("error", "Unknown error")
            logger.error(f"Failed to load NLLB model: {error}")
            self._kill_worker()
            if not self._ensure_worker():
                return texts
            load_result = self._load_model()
            if not load_result.get("ok"):
                return texts

        SENTENCE_ENDERS = set('.!?\u3002\uff01\uff1f')
        slots = []
        flat_fragments = []
        for t in texts:
            normalized = _normalize_unicode(t)
            if _should_skip_translation(normalized):
                slots.append({"source": t, "kind": "skip", "caps": False,
                              "start": 0, "end": 0})
                continue

            body, was_caps = _normalize_caps(normalized)

            fragments = [body]
            if len(body) >= _SPLIT_SENTENCES_CHAR_LIMIT:
                split = _split_sentences(body)
                if len(split) > 1:
                    fragments = split

            # Add a period to longer unpunctuated fragments so NLLB doesn't
            # invent a continuation.
            sanitized = []
            for f in fragments:
                stripped = f.rstrip()
                if not stripped:
                    sanitized.append(f)
                    continue
                word_count = len(stripped.split())
                if stripped[-1] not in SENTENCE_ENDERS and word_count > 3:
                    sanitized.append(stripped + '.')
                else:
                    sanitized.append(stripped)

            start = len(flat_fragments)
            flat_fragments.extend(sanitized)
            slots.append({
                "source": t, "kind": "translate", "caps": was_caps,
                "start": start, "end": len(flat_fragments),
            })

        skipped = sum(1 for s in slots if s["kind"] == "skip")

        if not flat_fragments:
            logger.debug(
                f"CT2 translate: {len(texts)} inputs, all skipped, {src_nllb} -> {tgt_nllb}"
            )
            return [s["source"] for s in slots]

        # Dedupe identical fragments (repeated UI strings, names, HP/Lv labels)
        unique_fragments = []
        dedupe_index = {}
        unique_for_fragment = []
        for f in flat_fragments:
            idx = dedupe_index.get(f)
            if idx is None:
                idx = len(unique_fragments)
                dedupe_index[f] = idx
                unique_fragments.append(f)
            unique_for_fragment.append(idx)

        logger.debug(
            f"CT2 translate: {len(texts)} inputs, {len(flat_fragments)} fragments "
            f"({len(unique_fragments)} unique, {skipped} skipped), "
            f"{src_nllb} -> {tgt_nllb}"
        )
        for i, f in enumerate(unique_fragments):
            logger.debug(f"  CT2 input[{i}]: ({len(f)} chars) {f[:200]}")

        result = self._send_command({
            "cmd": "translate",
            "texts": unique_fragments,
            "src_lang": src_nllb,
            "tgt_lang": tgt_nllb,
        })
        if not result.get("ok"):
            logger.error(f"Translation failed: {result.get('error')}")
            return texts

        unique_translations = result.get("translations")
        if not isinstance(unique_translations, list) or len(unique_translations) != len(unique_fragments):
            logger.error(
                f"Worker returned malformed response: expected {len(unique_fragments)} "
                f"translations, got {len(unique_translations) if isinstance(unique_translations, list) else type(unique_translations).__name__}"
            )
            return texts

        flat_translations = [unique_translations[i] for i in unique_for_fragment]
        if result.get("token_counts"):
            logger.debug(f"  CT2 token counts: {result['token_counts']}")
        if result.get("confidences"):
            logger.debug(f"  CT2 per-token log-probs: {result['confidences']}")

        translations = []
        for slot in slots:
            if slot["kind"] == "skip":
                translations.append(slot["source"])
                continue
            pieces = flat_translations[slot["start"]:slot["end"]]
            out = " ".join(p for p in pieces if p)
            if slot["caps"]:
                out = out.upper()
            translations.append(out)

        for i, t in enumerate(translations):
            src_len = len(texts[i]) if i < len(texts) else 0
            logger.debug(
                f"  CT2 output[{i}]: ({len(t)} chars, input was {src_len}) {t[:200]}"
            )
            # Multi-fragment slots can shrink on rejoin
            slot = slots[i]
            fragment_count = slot["end"] - slot["start"]
            if (
                src_len > 0
                and len(t) < src_len * 0.3
                and slot["kind"] == "translate"
                and fragment_count == 1
            ):
                logger.warning(
                    f"  CT2 possible truncation: output is {len(t)}/{src_len} chars "
                    f"({len(t)*100//src_len}%)"
                )

        return translations

    def _kill_worker(self):
        with self._worker_lock:
            if self._worker_process:
                try:
                    self._worker_process.kill()
                    self._worker_process.wait(timeout=5)
                except Exception:
                    pass
                self._worker_process = None
                self._loaded_model_dir = None

    def set_persistent_mode(self, enabled: bool) -> None:
        enabled = bool(enabled)
        if enabled == self._persistent_mode:
            return
        self._persistent_mode = enabled
        logger.info(f"CT2 persistent mode: {enabled}")
        if enabled:
            # Warm up so the first translate is faster
            threading.Thread(target=self._warmup_worker, daemon=True).start()
        else:
            self.shutdown()

    def _warmup_worker(self) -> None:
        if not self._persistent_mode:
            return
        if not self._model_manager.is_model_downloaded():
            return
        # recycle existing worker so the env var takes effect.
        if self._worker_process and self._worker_process.poll() is None:
            self._kill_worker()
        if self._ensure_worker():
            self._load_model()

    def shutdown(self):
        with self._worker_lock:
            if self._worker_process and self._worker_process.poll() is None:
                try:
                    line = json.dumps({"cmd": "shutdown"}) + "\n"
                    self._worker_process.stdin.write(line.encode('utf-8'))
                    self._worker_process.stdin.flush()
                    self._worker_process.wait(timeout=5)
                except Exception:
                    try:
                        self._worker_process.kill()
                        self._worker_process.wait(timeout=5)
                    except Exception:
                        pass
                self._worker_process = None
                self._loaded_model_dir = None
                logger.info("CT2 translation worker shut down")

    def unload_current_model(self):
        if self._worker_process and self._worker_process.poll() is None:
            self._send_command({"cmd": "unload"})
            self._loaded_model_dir = None
