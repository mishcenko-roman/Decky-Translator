#!/usr/bin/env python3
"""
Persistent subprocess worker for CTranslate2 + NLLB-200 translation.

Communicates via stdin/stdout JSON-lines protocol.
Commands:
    {"cmd": "load", "model_dir": "/path/to/model"}
    {"cmd": "translate", "texts": ["Hello", "World"], "src_lang": "eng_Latn", "tgt_lang": "fra_Latn"}
    {"cmd": "unload"}
    {"cmd": "shutdown"}

Responses:
    {"ok": true, "translations": ["..."]}
    {"ok": false, "error": "message"}

Self-terminates after 10 minutes of inactivity.
"""

import json
import os
import signal
import sys
import time

IDLE_TIMEOUT = 600  # 10 minutes

# Try to set PR_SET_PDEATHSIG so we die if parent crashes
try:
    import ctypes
    libc = ctypes.CDLL("libc.so.6", use_errno=True)
    PR_SET_PDEATHSIG = 1
    libc.prctl(PR_SET_PDEATHSIG, signal.SIGTERM)
except Exception:
    pass

# Redirect stderr to avoid blocking on pipe buffer
try:
    devnull = open(os.devnull, 'w')
    sys.stderr = devnull
except Exception:
    pass


def main():
    translator = None
    tokenizer = None
    last_activity = time.monotonic()
    loaded_model_dir = None

    # Import heavy libraries
    try:
        import ctranslate2
        import sentencepiece as spm
    except ImportError as e:
        resp = {"ok": False, "error": f"Import failed: {e}"}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    def send(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    def load_model(model_dir):
        nonlocal translator, tokenizer, loaded_model_dir

        unload_model()

        model_bin = os.path.join(model_dir, "model.bin")
        sp_model = os.path.join(model_dir, "sentencepiece.bpe.model")

        if not os.path.exists(model_bin):
            return {"ok": False, "error": f"model.bin not found in {model_dir}"}
        if not os.path.exists(sp_model):
            return {"ok": False, "error": f"sentencepiece.bpe.model not found in {model_dir}"}

        try:
            translator = ctranslate2.Translator(
                model_dir,
                device="cpu",
                inter_threads=1,
                intra_threads=4,
                compute_type="int8",
            )
            tokenizer = spm.SentencePieceProcessor(sp_model)
            loaded_model_dir = model_dir
            return {"ok": True}
        except Exception as e:
            unload_model()
            return {"ok": False, "error": f"Failed to load model: {e}"}

    def unload_model():
        nonlocal translator, tokenizer, loaded_model_dir
        translator = None
        tokenizer = None
        loaded_model_dir = None

    def translate_texts(texts, src_lang, tgt_lang):
        if translator is None or tokenizer is None:
            return {"ok": False, "error": "No model loaded"}

        try:
            # NLLB tokenization: [src_lang] + sp_tokens + [</s>]
            tokenized = []
            for t in texts:
                sp_tokens = tokenizer.encode(t, out_type=str)
                tokenized.append([src_lang] + sp_tokens + ["</s>"])

            # Translate with target language prefix
            results = translator.translate_batch(
                tokenized,
                target_prefix=[[tgt_lang]] * len(texts),
                beam_size=2,
                max_decoding_length=512,
                repetition_penalty=1.2,
            )

            # Detokenize: skip first token (target lang token)
            translations = []
            for result in results:
                tokens = result.hypotheses[0]
                if tokens and tokens[0] == tgt_lang:
                    tokens = tokens[1:]
                text = tokenizer.decode(tokens)
                translations.append(text)

            return {"ok": True, "translations": translations}
        except Exception as e:
            return {"ok": False, "error": f"Translation failed: {e}"}

    # Main loop with idle timeout
    import select

    while True:
        if time.monotonic() - last_activity > IDLE_TIMEOUT:
            break

        try:
            ready, _, _ = select.select([sys.stdin], [], [], 30.0)
        except (ValueError, OSError):
            break

        if not ready:
            continue

        line = sys.stdin.readline()
        if not line:
            break

        last_activity = time.monotonic()
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            send({"ok": False, "error": "Invalid JSON"})
            continue

        command = cmd.get("cmd")

        if command == "load":
            model_dir = cmd.get("model_dir", "")
            result = load_model(model_dir)
            send(result)

        elif command == "translate":
            texts = cmd.get("texts", [])
            src_lang = cmd.get("src_lang", "")
            tgt_lang = cmd.get("tgt_lang", "")
            if not texts:
                send({"ok": True, "translations": []})
            elif not src_lang or not tgt_lang:
                send({"ok": False, "error": "src_lang and tgt_lang required"})
            else:
                result = translate_texts(texts, src_lang, tgt_lang)
                send(result)

        elif command == "unload":
            unload_model()
            send({"ok": True})

        elif command == "shutdown":
            send({"ok": True})
            break

        else:
            send({"ok": False, "error": f"Unknown command: {command}"})


if __name__ == "__main__":
    main()
