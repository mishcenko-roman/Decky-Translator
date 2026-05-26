# Decky Translator - Quick Summary & Architecture Diagrams

## Current State (Manual Mode)

### Data Flow Diagram
```
┌────────────────────────────────────────────────────────────┐
│                     Frontend (React/TS)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Input.tsx - HIDRaw Button Monitor                │  │
│  │    - Polls backend every 100ms (10Hz)               │  │
│  │    - Detects L5, R4, etc button presses             │  │
│  └────────┬─────────────────────────────────────────────┘  │
│           │ Button Pressed                                 │
│           ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 2. Translator.tsx - Game Logic                       │  │
│  │    - Pauses game (optional)                          │  │
│  │    - Takes screenshot                                │  │
│  └────────┬─────────────────────────────────────────────┘  │
│           │ RPC: take_screenshot()                         │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ Base64 PNG (100-300KB)
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│                     Backend (Python)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 3. main.py - take_screenshot()                       │  │
│  │    - Global lock prevents concurrent calls           │  │
│  │    - GStreamer pipeline (pipewiresrc → PNG)          │  │
│  │    - Returns base64 PNG                              │  │
│  │    - Time: 1-3 seconds                               │  │
│  └────────┬─────────────────────────────────────────────┘  │
│           │ RPC Return: base64 data                        │
└───────────┼──────────────────────────────────────────────────┘
            │
            ▼
│  ┌──────────────────────────────────────────────────────┐
│  │ 4. Overlay.tsx - Show Image                          │
│  │    - Displays screenshot in overlay                  │
│  │    - User sees image immediately                     │  
│  │    - Time: <100ms                                    │  
│  └────────┬──────────────────────────────────────────────┘  │
│           │ RPC: recognize_text(base64)                    │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ Base64 PNG + OCR params
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 5. main.py - recognize_text() (OCR)                  │  │
│  │    - Decode base64 → PNG bytes                       │  │
│  │    - Load OCR provider (RapidOCR, etc)               │  │
│  │    - Detect text regions with bounding boxes         │  │
│  │    - Return TextRegion[] objects                     │  │
│  │    - Time: 2-5 seconds (RapidOCR)                    │  │
│  └────────┬─────────────────────────────────────────────┘  │
│           │ RPC Return: TextRegion[]                       │
└───────────┼──────────────────────────────────────────────────┘
            │
            ▼
│  ┌──────────────────────────────────────────────────────┐
│  │ 6. TextTranslator.tsx - Translate                    │  
│  │    - Send OCR regions to backend                     │  
│  │    - Call RPC: translate_text(regions, lang)         │  
│  └────────┬──────────────────────────────────────────────┘  │
│           │ RPC: translate_text(regions, 'uk')             │
└───────────┼──────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 7. main.py - translate_text() (Translation)          │  │
│  │    - Extract text from regions                       │  │
│  │    - Call translation provider (CTranslate2, etc)    │  │
│  │    - Merge translations back to regions              │  │
│  │    - Return TranslatedRegion[]                       │  │
│  │    - Time: 0.5-2 seconds (cached) or 1-3s (fresh)   │  │
│  └────────┬─────────────────────────────────────────────┘  │
│           │ RPC Return: TranslatedRegion[]                 │
└───────────┼──────────────────────────────────────────────────┘
            │
            ▼
│  ┌──────────────────────────────────────────────────────┐
│  │ 8. Overlay.tsx - Render                              │
│  │    - Position translated text over original image    │  
│  │    - Render with React                               │  
│  │    - User sees translated overlay                    │
│  │    - Time: <100ms                                    │
│  └──────────────────────────────────────────────────────┘

TOTAL LATENCY: 3.5-10+ seconds
```

**Current Limitations:**
- ❌ No continuous monitoring
- ❌ Blocks on each step (no pipelining)
- ❌ Only manual trigger
- ❌ Sequential RPC calls
- ❌ Global lock prevents parallel processing
- ❌ No translation caching

---

## Proposed Real-Time Architecture

### New Data Flow Diagram
```
┌─────────────────────────────────────────────────────┐
│     Backend Screenshot Loop (Async Thread)          │
│  ┌──────────────────────────────────────────────┐  │
│  │ _screenshot_loop_worker()                    │  │
│  │ - Captures frames at 5 FPS (200ms interval)  │  │
│  │ - Enqueues to FrameQueue (max 3 frames)      │  │
│  │ - Drops old frames if queue full             │  │
│  │ - Time: ~500-1000ms per frame                │  │
│  └──────────────────────────────────────────────┘  │
│              │                                       │
│              ▼                                       │
│  ┌──────────────────────────────────────────────┐  │
│  │ FrameQueue: [Frame_N-2, Frame_N-1, Frame_N] │  │
│  │ - Latest frame always available              │  │
│  │ - Old frames dropped on overflow             │  │
│  └──────────────────────────────────────────────┘  │
└──────────────────┬────────────────────────────────┘
                   │
        Frontend polls every 100ms
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│              Frontend (React)                        │
│  ┌──────────────────────────────────────────────┐  │
│  │ get_current_frame()                          │  │
│  │ - Get latest frame from queue                │  │
│  │ - Display immediately in overlay             │  │
│  │ - Time: <50ms RPC                            │  │
│  └──────────┬───────────────────────────────────┘  │
│             │                                       │
│             ▼                                       │
│  ┌──────────────────────────────────────────────┐  │
│  │ Overlay.tsx - Show Frame                     │  │
│  │ - Display screenshot                         │  │
│  │ - Time: <100ms render                        │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

IN PARALLEL: OCR & Translation Processing
                   │
        ┌──────────┴──────────┬──────────┐
        │                     │          │
        ▼                     ▼          ▼
   Frame_N-2            Frame_N-1   Frame_N
        │                     │          │
        └──────┬──────────────┴──────────┘
               │ (async, non-blocking)
               ▼
    ┌──────────────────────────┐
    │ OCR Pipeline (RapidOCR)  │
    │ - Process in background  │
    │ - Smart frame skipping   │
    │ - Time: ~1-2s per frame  │
    │ - Persistent worker mode │
    └──────────┬───────────────┘
               │ TextRegion[]
               ▼
    ┌──────────────────────────────────┐
    │ Translation Pipeline             │
    │ - Check cache (60% hit rate)     │
    │ - Translate new regions only     │
    │ - Time: 100ms-1s                 │
    │ - Batch process                  │
    └──────────┬───────────────────────┘
               │ TranslatedRegion[]
               ▼
    ┌──────────────────────────────────┐
    │ Update Overlay with Results      │
    │ - Only update when complete      │
    │ - Merge with current frame       │
    │ - Render translated text         │
    │ - Time: <100ms                   │
    └──────────────────────────────────┘

KEY DIFFERENCES:
✅ Continuous frame capture (background loop)
✅ Non-blocking RPC calls (async/await)
✅ Parallel OCR + Translation processing
✅ Translation caching (reduce latency)
✅ Frame skipping (reduce CPU load)
✅ Async processing pipeline
✅ Memory-aware queue management

NEW LATENCY BREAKDOWN:
- Screenshot → Display: <100ms (just latest frame)
- OCR Processing: ~1-2s (in background)
- Translation: 100ms-1s (cached or fresh)
- Overlay Update: <100ms when ready
- Per-Frame Delay: 0ms (display updates independently of processing)
```

---

## Component Interaction Diagram

### Current (Manual)
```
User Input → Button Press → RPC Chain → Display Result
             └→ Sequential
                ├→ take_screenshot() [1-3s]
                ├→ recognize_text()  [2-5s]
                └→ translate_text()  [0.5-2s]
                    Total: 3.5-10s
```

### Proposed (Real-Time)
```
User Input → Continuous Loop (Background)
             ├→ Screenshot Loop   [async, 200ms/frame]
             │  ├→ Capture Frame
             │  ├→ Queue Frame
             │  └→ Repeat
             │
             ├→ Frontend Polling  [100ms interval]
             │  ├→ get_current_frame()
             │  └→ Display immediately
             │
             └→ OCR Pipeline     [async, in parallel]
                ├→ Take from queue
                ├→ Skip frames if needed
                ├→ recognize_text() [async]
                ├→ translate_text() [async, with cache]
                └→ Update overlay when ready
```

---

## Technology Stack Comparison

### OCR Providers
```
Provider              Speed    Accuracy  Cost    Location  GPU?
─────────────────────────────────────────────────────────────
RapidOCR (ONNX)      2-5s     High      Free    Local     ❌
ChromeScreenAI       1-2s     High      Free    Local     ❌
Google Vision API    1-3s     Very High Paid    Cloud     ✅
OCR.space            2-5s     Medium    Free    Cloud     ❌
Gemini Vision        2-4s     Very High Paid    Cloud     ✅

⭐ For Real-Time: ChromeScreenAI (fastest) or RapidOCR (free)
```

### Translation Providers
```
Provider             Speed    Accuracy  Cost    Offline?  Cache-Friendly?
──────────────────────────────────────────────────────────────────────
CTranslate2+NLLB     500ms    Good      Free    ✅        ✅ (batching)
FreeGoogle Translate 1-2s     Good      Free    ❌        ⚠️  (rate-limited)
Google Translate API 1-2s     Excellent Paid    ❌        ✅ (batching)
Gemini Vision        2-4s     Excellent Paid    ❌        ⚠️  (1 call)

⭐ For Real-Time Ukrainian: CTranslate2+NLLB (local, free, fast)
```

---

## Performance Predictions

### Current System (Manual Mode)
```
Button Press → 3-10 seconds → Translation Overlay

Breakdown:
├─ Screenshot:    1-3s   (GStreamer, PipeWire)
├─ OCR:           2-5s   (RapidOCR cold start)
├─ Translation:   0.5-2s (CTranslate2)
└─ Network:       <100ms (RPC calls)
```

### Proposed Real-Time System
```
Continuous Mode: 5-10 FPS with smooth updates

First Frame (Cold Start):
├─ Screenshot:    ~500ms (lower resolution)
├─ OCR:           ~1-2s  (persistent worker, 720p)
├─ Translation:   ~1s    (NLLB, batch)
└─ Display Delay: ~0ms   (queued, not sequential)
   Total: ~2-3s until first translation visible

Subsequent Frames (5 FPS target):
├─ New Frame Captured:     every 200ms
├─ Display to User:        <100ms after capture
├─ OCR Processing:         ~1-2s (in background)
├─ Cache Hit Rate:         ~60-80% (same game UI)
├─ Translation (cached):    <100ms
└─ Overlay Update:         when OCR + translation complete

User Experience:
- See new screenshots every 200ms
- Translations update with slight delay (1-2 frames)
- Text overlay appears/updates smoothly
- No stuttering in game (2 cores dedicated to game)
- CPU usage: ~25-30% on Steam Deck
```

---

## Memory Profile

### Current (Per Screenshot)
```
Python Process:        ~250MB
ONNX Models (VRAM):    ~500MB (cached after first OCR)
Screenshot Image:      ~100-300KB (PNG)
Intermediate Data:     ~50-100MB
─────────────────────────────────
Total Peak:           ~900MB-1.2GB
```

### Proposed (Streaming)
```
Python Process:        ~300MB
ONNX Models:           ~500MB (persistent)
Frame Queue (3x):      ~300-900KB
OCR Cache:             ~50MB (10k translations)
Translation Cache:     ~100MB (5k entries)
─────────────────────────────────
Total Peak:           ~1.0-1.2GB (same, but distributed)

Note: Memory stays stable, not spiking on each frame
```

---

## UI Flow Diagram

### Settings Screen Structure
```
Plugin Settings
├─ Main Tab
│  ├─ [Toggle] Enable Plugin
│  ├─ [Toggle] Real-Time Mode ← NEW
│  ├─ [Select] OCR Provider (RapidOCR, ChromeScreenAI, etc)
│  └─ [Select] Processing FPS (1-10) ← NEW
│
├─ Translation Tab
│  ├─ [Select] Source Language (Auto, English, Ukrainian, etc)
│  ├─ [Select] Target Language (Ukrainian ← NEW, English, etc)
│  ├─ [Select] Translation Provider
│  ├─ [Slider] Font Scale (0.5 - 2.0)
│  └─ [Toggle] Cache Status ← NEW
│
└─ Controls Tab
   ├─ [Select] Translate Button (L5, R4, etc)
   ├─ [Select] Dismiss Button
   └─ [Select] Toggle Button
```

---

## Ukrainian Language Support Checklist

```
✅ RapidOCR
   - Language code: 'uk'
   - Model family: 'eslav' (Slavic script)
   - Tested: No (needs manual test with Ukrainian image)

✅ CTranslate2 + NLLB
   - Source language: 'uk_UA'
   - Target language: 'uk_UA'
   - Tested: No (needs manual test)

✅ Text Rendering
   - Cyrillic fonts: Need to add 'Noto Sans Cyrillic'
   - Font fallback chain: Ukrainian → Latin → Generic
   - Tested: No (visual inspection needed)

✅ All Other Providers
   - Google Vision: Supports Ukrainian ✅
   - Gemini Vision: Supports Ukrainian ✅
   - Free Google Translate: Supports Ukrainian ✅
   - Google Translate API: Supports Ukrainian ✅
```

---

## Risk Assessment

### High Risk ⚠️
1. **GStreamer Latency**: Can't optimize further without changing capture method
   - Mitigation: Preload PipeWire, cache resources

2. **ONNX Memory**: Large models (500MB+) on Steam Deck
   - Mitigation: Use model quantization, lower resolution

3. **Game Interference**: Real-time processing eats CPU
   - Mitigation: Core affinity, frame skipping, lower FPS

### Medium Risk ⚠️
4. **Translation Cache Invalidation**: Stale translations if settings change
   - Mitigation: Clear cache on language/provider change

5. **Frame Queue Overflow**: Memory pressure during heavy text scenes
   - Mitigation: Monitor memory, drop frames if needed

### Low Risk ✅
6. **Cyrillic Rendering**: Font support varies
   - Mitigation: Bundle Noto Sans Cyrillic, test thoroughly

7. **Regional Variations**: Ukrainian dialects
   - Mitigation: Use modern models (NLLB-200)

---

## Recommended Reading Order

1. **Start Here**: This file (quick overview)
2. **Understand Current**: ARCHITECTURE_ANALYSIS.md (detailed current flow)
3. **Plan Implementation**: IMPLEMENTATION_PLAN.md (phased approach)
4. **Deep Dive**: Look at `main.py`, `providers/__init__.py`, `Translator.tsx`

---

## Quick Reference: Key Files

| Purpose | File | Lines | Key Functions |
|---------|------|-------|---|
| **Plugin Entry** | main.py | 1-200 | Plugin class, dependency setup |
| **Screenshot Loop** | main.py | 1265-1390 | take_screenshot(), GStreamer |
| **OCR Processing** | main.py | 1599-1650 | recognize_text() |
| **Translation** | main.py | 1676-1745 | translate_text() |
| **Provider System** | providers/__init__.py | 50-300 | ProviderManager |
| **RapidOCR** | providers/rapidocr_provider.py | 1-200 | RapidOCRProvider class |
| **Frontend Logic** | Translator.tsx | 1-150 | GameTranslatorLogic |
| **Button Input** | Input.tsx | 1-200 | Input class, polling |
| **Overlay Render** | Overlay.tsx | 1-300 | ImageOverlay, text positioning |
| **Settings** | SettingsContext.tsx | 1-100 | Settings provider |

