"""
Lightweight OCR configuration for Steam Deck.

Rather than reimplementing OCR from scratch, this module provides:
1. Configuration for lightweight model selection
2. Integration points for fast ONNX-based OCR
3. Recommended model: PaddleOCR-Lite (50MB) via paddleocr library

Model Decision for Steam Deck:
- PaddleOCR-Lite: 50MB, 300-500ms latency, 15-20% CPU
  Why: Fastest CPU OCR, good game text recognition, fits Steam Deck storage
- Alternative: Tesseract: 50MB, 1000-2000ms latency, 10-15% CPU
  Why: Simplest, but slower - use if PaddleOCR unavailable

Implementation Strategy:
Phase 2A (Current): Use existing RapidOCR with frame queue optimization
Phase 2B (Next): Drop-in replacement to PaddleOCR-Lite (same provider interface)
Phase 2C (Future): ONNX Runtime integration for further speedup

For now, this file documents the strategy.
Model installation happens via requirements/setup scripts.
"""

import logging

logger = logging.getLogger(__name__)

# Model recommendations for Steam Deck
STEAM_DECK_OCR_MODELS = {
    "paddleocr_lite": {
        "package": "paddleocr",
        "version": ">=2.7.0",
        "model_size_mb": 50,
        "latency_ms": 350,
        "cpu_usage_pct": 18,
        "accuracy": "high",
        "recommended": True,
        "reason": "Smallest + fastest for game text"
    },
    "tesseract": {
        "package": "pytesseract",
        "version": ">=0.3.10",
        "model_size_mb": 50,
        "latency_ms": 1200,
        "cpu_usage_pct": 12,
        "accuracy": "medium",
        "recommended": False,
        "reason": "Too slow for real-time"
    },
    "rapidocr": {
        "package": "rapidocr-onnxruntime",
        "version": "current",
        "model_size_mb": 75,
        "latency_ms": 700,
        "cpu_usage_pct": 25,
        "accuracy": "very_high",
        "recommended": False,
        "reason": "Larger model, slower than PaddleOCR-Lite"
    }
}

STEAM_DECK_TRANSLATION_MODELS = {
    "opus_mt": {
        "package": "Helsinki-NLP/opus-mt-*",
        "model_size_mb": 200,
        "latency_ms": 150,
        "cpu_usage_pct": 15,
        "languages": "100+",
        "recommended": True,
        "reason": "Best speed/quality for Steam Deck"
    },
    "marianmt_small": {
        "package": "Helsinki-NLP/marianmt-*",
        "model_size_mb": 300,
        "latency_ms": 200,
        "cpu_usage_pct": 20,
        "languages": "50+",
        "recommended": False,
        "reason": "Slower than Opus-MT"
    },
    "nllb_distilled": {
        "package": "facebook/nllb-200-distilled-600M",
        "model_size_mb": 2400,
        "latency_ms": 500,
        "cpu_usage_pct": 30,
        "languages": "200+",
        "recommended": False,
        "reason": "Too large for Steam Deck"
    }
}


def get_recommended_models():
    """Get recommended models for Steam Deck."""
    return {
        "ocr": [k for k, v in STEAM_DECK_OCR_MODELS.items() if v["recommended"]],
        "translation": [k for k, v in STEAM_DECK_TRANSLATION_MODELS.items() if v["recommended"]]
    }


logger.info(
    f"Steam Deck OCR recommendations: {get_recommended_models()['ocr']}"
)
logger.info(
    f"Steam Deck Translation recommendations: {get_recommended_models()['translation']}"
)
