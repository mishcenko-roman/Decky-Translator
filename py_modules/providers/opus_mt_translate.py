# providers/opus_mt_translate.py
# Opus-MT translation provider for lightweight on-device translation
# Uses Helsinki-NLP/opus-mt models for fast, accurate translation

import json
import logging
import os
import threading
from typing import List, Optional

from .base import TranslationProvider, ProviderType

logger = logging.getLogger(__name__)

WORKER_TIMEOUT = 60


class OpusMTTranslateProvider(TranslationProvider):
    """
    Lightweight translation using Opus-MT models (Helsinki-NLP).
    Runs locally without requiring API keys.
    
    Supports 100+ language pairs with faster inference than NLLB-200.
    Models are ~200MB per language pair vs 1.4GB for NLLB.
    """

    # Supported language pairs (mapping of (src, tgt) tuples)
    SUPPORTED_PAIRS = {
        ('uk', 'en'): 'Helsinki-NLP/opus-mt-uk-en',
        ('en', 'uk'): 'Helsinki-NLP/opus-mt-en-uk',
        ('ru', 'en'): 'Helsinki-NLP/opus-mt-ru-en',
        ('en', 'ru'): 'Helsinki-NLP/opus-mt-en-ru',
        ('de', 'en'): 'Helsinki-NLP/opus-mt-de-en',
        ('en', 'de'): 'Helsinki-NLP/opus-mt-en-de',
        ('fr', 'en'): 'Helsinki-NLP/opus-mt-fr-en',
        ('en', 'fr'): 'Helsinki-NLP/opus-mt-en-fr',
        ('es', 'en'): 'Helsinki-NLP/opus-mt-es-en',
        ('en', 'es'): 'Helsinki-NLP/opus-mt-en-es',
        ('ja', 'en'): 'Helsinki-NLP/opus-mt-ja-en',
        ('en', 'ja'): 'Helsinki-NLP/opus-mt-en-ja',
        ('zh', 'en'): 'Helsinki-NLP/opus-mt-zh-en',
        ('en', 'zh'): 'Helsinki-NLP/opus-mt-en-zh',
    }

    def __init__(self, models_dir: str = ""):
        """
        Initialize Opus-MT translation provider.
        
        Args:
            models_dir: Directory to cache downloaded models
        """
        self._models_dir = models_dir or os.path.expanduser("~/.cache/opus-mt")
        self._model = None
        self._tokenizer = None
        self._current_model_id = None
        self._lock = threading.Lock()
        self._loaded_pair = None

        logger.info(f"OpusMTTranslateProvider initialized (models_dir={self._models_dir})")

    def provider_type(self) -> ProviderType:
        return ProviderType.OPUS_MT

    @property
    def name(self) -> str:
        """Provider name for display."""
        return "Opus-MT (Helsinki-NLP)"

    def is_available(self, source_lang: str = "auto", target_lang: str = "en") -> bool:
        """Check if a language pair is available."""
        # For is_available() call without language pair, just return True if any pair is available
        if source_lang == "auto" or target_lang == "auto":
            return len(self.SUPPORTED_PAIRS) > 0
        return (source_lang, target_lang) in self.SUPPORTED_PAIRS

    def get_supported_languages(self) -> List[str]:
        """Return list of supported language codes."""
        languages = set()
        for src, tgt in self.SUPPORTED_PAIRS.keys():
            languages.add(src)
            languages.add(tgt)
        return sorted(list(languages))

    def _load_model(self, source_lang: str, target_lang: str) -> bool:
        """
        Load the model for a specific language pair (lazy loading with caching).
        
        Models are cached in self._model and self._tokenizer. On subsequent calls with
        the same language pair, the cached model is returned immediately without reloading.
        This eliminates the 500ms model load penalty on every translation request when the
        language pair remains constant.
        
        Args:
            source_lang: Source language code
            target_lang: Target language code
            
        Returns:
            True if model loaded or already cached, False if error or unsupported pair
        """
        with self._lock:
            pair = (source_lang, target_lang)
            
            # Check cache first - if pair matches and model is loaded, return immediately
            if self._loaded_pair == pair and self._model is not None and self._tokenizer is not None:
                logger.debug(f"Opus-MT model cache hit for {pair}")
                return True
            
            # Not supported?
            if pair not in self.SUPPORTED_PAIRS:
                logger.error(f"Language pair {source_lang}->{target_lang} not supported")
                return False
            
            try:
                from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
                
                model_id = self.SUPPORTED_PAIRS[pair]
                logger.info(f"Loading Opus-MT model: {model_id} (pair changed: {self._loaded_pair} -> {pair})")
                
                # Load with cache directory
                self._tokenizer = AutoTokenizer.from_pretrained(
                    model_id,
                    cache_dir=self._models_dir,
                    trust_remote_code=False
                )
                self._model = AutoModelForSeq2SeqLM.from_pretrained(
                    model_id,
                    cache_dir=self._models_dir,
                    trust_remote_code=False,
                    low_cpu_mem_usage=True,
                )
                
                # Set to CPU inference (Steam Deck doesn't have reliable GPU)
                self._model.eval()
                
                # Update cache state
                self._loaded_pair = pair
                self._current_model_id = model_id
                logger.info(f"Opus-MT model loaded successfully: {model_id}")
                return True
                
            except ImportError as e:
                logger.error(f"Missing required library: {e}. Install: pip install transformers torch")
                return False
            except Exception as e:
                logger.error(f"Failed to load Opus-MT model: {e}")
                return False

    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str
    ) -> str:
        """
        Translate a single text from source to target language.
        
        Args:
            text: Text string to translate
            source_lang: Source language code (required, "auto" not supported)
            target_lang: Target language code
            
        Returns:
            Translated text
        """
        results = await self.translate_batch([text], source_lang, target_lang)
        return results[0] if results else text

    async def translate_batch(
        self,
        texts: List[str],
        source_lang: str = "auto",
        target_lang: str = "en"
    ) -> List[str]:
        """
        Translate a batch of texts from source to target language.
        
        Args:
            texts: List of text strings to translate
            source_lang: Source language code (required, "auto" not supported)
            target_lang: Target language code
            
        Returns:
            List of translated strings (same length as input)
        """
        if not texts:
            return []
        
        if source_lang == "auto":
            logger.warning("Opus-MT does not support auto-detection. Using 'en' as default.")
            source_lang = "en"
        
        # Load model if not already loaded
        if not self._load_model(source_lang, target_lang):
            logger.error(f"Cannot translate: model not available for {source_lang}->{target_lang}")
            return texts  # Return input unchanged on error
        
        try:
            import torch
            
            with self._lock:
                # Batch translation
                inputs = self._tokenizer(texts, return_tensors="pt", padding=True, truncation=True, max_length=512)
                
                with torch.no_grad():
                    generated_tokens = self._model.generate(
                        **inputs,
                        max_length=512,
                        num_beams=1,  # Greedy decoding (faster)
                        early_stopping=False
                    )
                
                translations = self._tokenizer.batch_decode(generated_tokens, skip_special_tokens=True)
                
                logger.debug(f"Translated {len(texts)} texts from {source_lang} to {target_lang}")
                return translations
                
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return texts  # Return input unchanged on error

    def shutdown(self) -> None:
        """Clean up model resources."""
        with self._lock:
            self._model = None
            self._tokenizer = None
            self._loaded_pair = None
            logger.info("Opus-MT provider shut down")
