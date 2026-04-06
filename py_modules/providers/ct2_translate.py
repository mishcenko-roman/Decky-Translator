# providers/ct2_translate.py
# CTranslate2 + NLLB-200 translation provider

import json
import logging
import os
import subprocess
import threading
from typing import List, Optional

from .base import TranslationProvider, ProviderType
from .model_manager import NLLB_LANG_MAP, ModelManager

logger = logging.getLogger(__name__)

WORKER_TIMEOUT = 120
WORKER_STARTUP_TIMEOUT = 30


class CT2TranslateProvider(TranslationProvider):
    """
    Offline translation using CTranslate2 + NLLB-200 int8 model.
    Runs a persistent subprocess worker to avoid reloading models per request.
    """

    SUPPORTED_LANGUAGES = list(NLLB_LANG_MAP.keys())

    def __init__(self, model_manager: ModelManager, plugin_dir: str = ""):
        self._model_manager = model_manager
        self._plugin_dir = plugin_dir or os.environ.get(
            "DECKY_PLUGIN_DIR",
            "/home/deck/homebrew/plugins/decky-translator"
        )
        self._worker_process = None
        self._worker_lock = threading.Lock()
        self._loaded_model_dir = None
        self._python_path = None

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

        candidates = [
            '/usr/bin/python3',
            '/usr/bin/python3.13',
            '/usr/local/bin/python3',
        ]
        for path in candidates:
            if os.path.exists(path) and os.access(path, os.X_OK):
                self._python_path = path
                return path
        return None

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
            env['OMP_NUM_THREADS'] = '2'
            env['MKL_NUM_THREADS'] = '2'

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

        # Only append sentence-ending punctuation to longer texts that
        # look like truncated sentences. Short texts (labels, menu items)
        # get hallucinated into full sentences if we add a period.
        SENTENCE_ENDERS = set('.!?\u3002\uff01\uff1f')
        sanitized = []
        for t in texts:
            stripped = t.rstrip()
            word_count = len(stripped.split())
            if stripped and stripped[-1] not in SENTENCE_ENDERS and word_count > 3:
                sanitized.append(stripped + '.')
            else:
                sanitized.append(stripped if stripped else t)

        logger.debug(f"CT2 translate: {len(sanitized)} texts, {src_nllb} -> {tgt_nllb}")
        for i, t in enumerate(sanitized):
            logger.debug(f"  CT2 input[{i}]: ({len(t)} chars) {t[:200]}")

        result = self._send_command({
            "cmd": "translate",
            "texts": sanitized,
            "src_lang": src_nllb,
            "tgt_lang": tgt_nllb,
        })
        if result.get("ok"):
            translations = result.get("translations", texts)
            for i, t in enumerate(translations):
                src_len = len(texts[i]) if i < len(texts) else 0
                logger.debug(f"  CT2 output[{i}]: ({len(t)} chars, input was {src_len}) {t[:200]}")
                if src_len > 0 and len(t) < src_len * 0.3:
                    logger.warning(f"  CT2 possible truncation: output is {len(t)}/{src_len} chars ({len(t)*100//src_len}%)")
            if result.get("token_counts"):
                logger.debug(f"  CT2 token counts: {result['token_counts']}")
            return translations
        else:
            logger.error(f"Translation failed: {result.get('error')}")
            return texts

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
