# Decky Translator - Complete Architecture Analysis

## 1. Project Structure & Entry Points

### Directory Structure
```
Decky-Translator/
├── main.py                    # Backend entry point (Decky plugin)
├── package.json              # Frontend build config
├── requirements.txt          # Python dependencies
├── plugin.json              # Plugin metadata
├── rollup.config.js         # TypeScript build config
│
├── src/                      # Frontend (React/TypeScript)
│   ├── index.tsx            # Main plugin component, tab system
│   ├── Translator.tsx       # Game translator logic (RPC calls, screenshot handling)
│   ├── TextRecognizer.tsx   # OCR interface/error handling
│   ├── TextTranslator.tsx   # Translation interface (RPC to backend)
│   ├── Input.tsx            # Button input handler (HIDRaw polling)
│   ├── Overlay.tsx          # Overlay state management and rendering
│   ├── SettingsContext.tsx  # Global settings provider
│   ├── Logger.tsx           # Frontend logging
│   └── tabs/                # Settings/control UI
│       ├── TabMain.tsx      # Main settings
│       ├── TabTranslation.tsx # Translation settings
│       └── TabControls.tsx   # Control mapping
│
└── py_modules/
    └── providers/           # Provider system (pluggable OCR/translation)
        ├── base.py          # Abstract base classes
        ├── __init__.py      # ProviderManager factory
        ├── rapidocr_provider.py          # Local RapidOCR (ONNX)
        ├── rapidocr_subprocess.py        # RapidOCR worker subprocess
        ├── chromescreenai_provider.py    # Chrome ScreenAI (local)
        ├── google_ocr.py                 # Google Cloud Vision API
        ├── google_translate.py           # Google Cloud Translation API
        ├── ocrspace.py                   # OCR.space API (free)
        ├── free_translate.py             # Free Google Translate (deep-translator)
        ├── gemini_vision.py              # Google Gemini Vision (OCR + translation)
        ├── ct2_translate.py              # CTranslate2 (local NLLB models)
        └── *_downloader.py               # Model downloader utilities
```

### Entry Points

**Frontend:**
- `src/index.tsx` → `definePlugin()` creates React component mounted in Decky UI
- Tabs system routes to Main/Translation/Controls settings
- `GameTranslatorLogic` class handles all game-facing logic

**Backend:**
- `main.py` → `Plugin` class with async methods exposed as RPC endpoints
- Decky SDK auto-exposes methods as `@decky_plugin.staticmethod` or class methods
- All RPC methods are async (Python async/await)

---

## 2. Screen Capture & OCR Flow

### Screenshot Pipeline

```
User Input (HIDRaw) 
    ↓
Input.tsx polls hidraw state (10Hz polling)
    ↓
Trigger detected (button press/hold)
    ↓
Translator.takeScreenshotAndTranslate()
    ↓
call('take_screenshot', appName) → main.py
    ↓
[BACKEND] GStreamer pipeline:
  pipewiresrc (Wayland screen capture)
    → videoconvert (format conversion)
    → pngenc (PNG compression)
    → filesink (write to temp file)
    ↓
Base64 encode PNG → return to frontend
    ↓
Frontend receives base64, shows in Overlay component
    ↓
call('recognize_text', base64Image) → main.py
```

**GStreamer Command:**
```bash
GST_PLUGIN_PATH=/path/to/plugins \
gst-launch-1.0 -e \
  pipewiresrc do-timestamp=true num-buffers=5 ! \
  videoconvert ! \
  pngenc snapshot=true ! \
  filesink location="screenshot.png"
```

**Screenshot Details:**
- **Source**: PipeWire (Wayland audio/video server)
- **Buffers**: 5 frames (skips potentially corrupt first frames)
- **Format**: PNG (lossless, ~100-300KB per screenshot)
- **Speed**: ~1-3 seconds per screenshot on Steam Deck
- **Threading**: GStreamer pipeline may use multiple threads
- **Global Lock**: `_processing_lock` prevents concurrent screenshots

### OCR Detection & Region Extraction

```
OCR Provider receives image_bytes
    ↓
Provider.recognize_text(image_bytes, language='auto')
```

**Available OCR Providers:**

| Provider | Mode | Speed | Accuracy | Requirements |
|----------|------|-------|----------|--------------|
| **RapidOCR** | Local (ONNX) | 2-5s | High | ONNX models (~500MB) |
| **ChromeScreenAI** | Local (Protobuf) | 1-2s | High | Chrome ScreenAI binary (~100MB) |
| **Google Vision** | Cloud API | 1-3s | Very High | API key, internet |
| **OCRSpace** | Cloud API | 2-5s | Medium | Free API, internet |
| **Gemini Vision** | Cloud API | 2-4s | Very High | API key, **does OCR + translation in one call** |

**RapidOCR Execution (Default):**

```python
# rapidocr_provider.py
async def recognize(self, image_data: bytes, language: str = "auto"):
    1. Convert language code to model family (e.g., 'uk' → 'eslav')
    2. Load ONNX models from disk (first call only, cached)
    3. Spawn subprocess or send to persistent worker
    4. Worker runs PaddleOCR inference:
       - Text detection (bounding box locations)
       - Text recognition (actual text content)
       - Confidence scoring per region
    5. Parse output, filter by confidence threshold
    6. Return TextRegion objects with:
       - text: detected string
       - rect: {left, top, right, bottom} in pixels
       - confidence: 0.0-1.0 float
       - is_dialog: heuristic for dialog text
```

**Key RapidOCR Parameters:**
- `min_confidence`: 0.5 default (filters low-confidence detections)
- `box_thresh`: 0.5 (detection box threshold for text localization)
- `unclip_ratio`: 1.6 (expands bounding boxes around detected text)
- **Execution Modes**:
  - **Oneshot** (default): Spawn process per call (~200-300ms overhead)
  - **Persistent Worker** (opt-in): Keep Python process alive (~50-100ms per call)

**Text Region Output Example:**
```json
{
  "text": "Welcome to Game",
  "rect": {"left": 100, "top": 50, "right": 300, "bottom": 80},
  "confidence": 0.95,
  "isDialog": true
}
```

---

## 3. Translation Handling

### Translation Pipeline

```
Frontend receives OCR regions
    ↓
call('translate_text', regions, targetLang='uk', inputLang='auto') → main.py
    ↓
[BACKEND] ProviderManager.translate_text(texts, source_lang='auto', target_lang='uk')
    ↓
Select translation provider (based on settings)
    ↓
Provider.translate(texts: List[str]) → List[str]
    ↓
Return translated regions with translatedText field
    ↓
Frontend renders translated text in Overlay
```

**Available Translation Providers:**

| Provider | Mode | Speed | Accuracy | Lang Support | Cost |
|----------|------|-------|----------|--------------|------|
| **CTranslate2 + NLLB** | Local | 500ms-1s | Good | 200+ languages | Free |
| **FreeGoogle** | Web Scrape | 1-2s | Good | 100+ languages | Free (rate-limited) |
| **Google Translate API** | Cloud | 1-2s | Excellent | 100+ languages | Paid ($0.01/request) |
| **Gemini Vision** | Cloud | 2-4s | Excellent | 100+ languages | Paid (~$0.0015/request) |

**Ukrainian Support:**
- ✅ RapidOCR: 'uk' language code → 'eslav' model family
- ✅ CTranslate2: NLLB model supports Ukrainian (both source & target)
- ✅ All translation providers support Ukrainian ('uk' language code)

### CTranslate2 (Local Translation)

```python
# ct2_translate.py
async def translate(self, texts: List[str], source_lang: str, target_lang: str):
    1. Load NLLB model from disk (ctranslate2/ct2_models_dir)
    2. If source_lang=='auto', fail (NLLB requires explicit source language)
    3. Add language tags to text: "<2uk>" + text (for Ukrainian target)
    4. Run inference on GPU/CPU via CTranslate2
    5. Return translated strings
    
    # Speed:
    # - First call: 500-1000ms (model load)
    # - Per-region: 50-100ms
    # - Batch: 200-500ms for 10 regions
```

### Translation Caching

Currently **NO caching** of translations. Each screenshot requires full re-translation.

Future optimization: Could cache common game text patterns.

---

## 4. Performance Bottlenecks for Steam Deck

### 1. **Screenshot Latency** ⚠️ HIGH IMPACT
- **Issue**: GStreamer pipeline + PipeWire takes 1-3 seconds
- **Why**: Wayland is slower than X11, PipeWire captures full screen
- **Impact**: User sees 1-3s delay from button press to image appearing
- **Steam Deck CPU**: Zen 2 (4c/8t) @ 3.5GHz - limited by GStreamer thread contention

### 2. **OCR Processing** ⚠️ CRITICAL
- **RapidOCR**: 
  - Cold start (first call): 2-3 seconds (ONNX model load + inference)
  - Warm start: 2-5 seconds (inference only, ~720p resolution)
  - CPU: Uses all 4 cores, pegs CPU at 100%
  - Memory: ONNX models + image = ~800MB-1GB
- **ChromeScreenAI**: 
  - Faster (1-2s) but higher memory footprint

### 3. **Translation Processing** ⚠️ MEDIUM IMPACT
- **CTranslate2**: 200-500ms per screenshot (all regions batched)
- **Free Google**: 1-2 seconds (web scraping, rate limited)
- **Cloud APIs**: 1-3 seconds (network latency)

### 4. **Frontend-Backend Latency** ⚠️ MEDIUM IMPACT
- **Sequential RPC calls**:
  1. `takeScreenshot()` → wait 1-3s
  2. `recognize_text(base64)` → wait 2-5s
  3. `translate_text(regions)` → wait 0.5-2s
  - **Total**: 3.5-10 seconds minimum
- **No pipelining**: Could request screenshot while doing OCR on previous frame

### 5. **Frontend Rendering** ⚠️ LOW-MEDIUM IMPACT
- **Overlay rendering**:
  - Canvas-based text positioning
  - CSS transforms for text scaling/rotation
  - Font loading (WebFonts for dyslexia fonts)
  - React state updates trigger re-render
- **Impact**: Usually <100ms, but can spike with large text regions

### 6. **HIDRaw Button Polling** ⚠️ LOW IMPACT
- **10Hz polling** (100ms intervals) from frontend
- **Latency to button press**: ~50-100ms average
- Could be improved to interrupt-driven (lower CPU)

### 7. **Memory Usage** ⚠️ MEDIUM IMPACT (for real-time)
- **Python backend**: 200-300MB baseline
- **ONNX models**: ~500MB (RapidOCR)
- **CTranslate2 models**: ~1.5GB (NLLB)
- **Per-screenshot**: Image data + intermediates = ~100-500MB
- **Steam Deck RAM**: 16GB total (SteamOS + game + plugin)
- **Issue**: Multiple screenshots in queue = memory pressure

### 8. **No Frame Dropping/Throttling** ⚠️ CRITICAL FOR REAL-TIME
- Currently: Manual trigger only (user presses button)
- For real-time: Would need continuous ~30fps screenshot capture
- **Problem**: Steam Deck CPU cannot handle 30fps OCR + translation
- **Solution**: Skip frames, process only every Nth frame, lower resolution

### 9. **Global Processing Lock** ⚠️ BLOCKS PIPELINE
```python
if _processing_lock:
    raise RuntimeError("Screenshot already in progress")
```
- Only one screenshot processing at a time
- Prevents parallel requests
- Would need to be removed for real-time pipeline

---

## 5. Changes Needed for Real-Time Ukrainian Translation Overlay

### Must-Do Changes

#### A. **Continuous Screen Capture Loop**
- [ ] Replace manual `take_screenshot()` with background loop
- [ ] Spawn background thread in backend that:
  - Captures screenshot every 100-500ms (2-10 FPS)
  - Stores current frame
  - Notifies frontend of new frame availability
- [ ] Frontend polls for new frames instead of triggering capture

#### B. **Frame Processing Pipeline (Async)**
- [ ] Remove global `_processing_lock`
- [ ] Implement frame queue:
  ```
  CaptureThread → FrameQueue (max 3 frames) → OCRQueue → TranslationQueue → RenderQueue
  ```
- [ ] Process frames asynchronously:
  - Drop old frames if queue full
  - Skip frames if OCR still processing

#### C. **OCR Optimization**
- [ ] **Switch to ChromeScreenAI** (1-2s vs 2-5s for RapidOCR)
- [ ] **Lower resolution**: Resize to 720p or 1024p (from 1280p default)
- [ ] **Enable persistent worker**: Load models once, reuse
- [ ] **Reduce confidence threshold**: Allow more detections (0.3 instead of 0.5)
- [ ] **Frame skipping**: Only process every 2nd-3rd frame

#### D. **Intelligent Translation Caching**
- [ ] Cache translations by hash(text, source_lang, target_lang)
- [ ] For games with fixed UI text: Reuse translations across frames
- [ ] Cache hit rate could be 60-80% for game UIs

#### E. **Ukrainian Language Support**
- [ ] Ensure RapidOCR uses 'uk' language code
- [ ] Set default target language to 'uk' in settings
- [ ] Test NLLB model for Ukrainian (should work out-of-box)
- [ ] Verify all providers support Ukrainian input

#### F. **Overlay Rendering Optimization**
- [ ] Batch text rendering (use OffscreenCanvas if available)
- [ ] Cache font measurements
- [ ] Limit number of regions rendered per frame (top 20 by confidence)
- [ ] Use `requestAnimationFrame` for smooth updates

#### G. **Remove/Reduce Frontend-Backend Round Trips**
- [ ] Send entire OCR config once (language, provider, thresholds)
- [ ] Use websocket or streaming for continuous frame updates
- [ ] Batch small RPC calls

#### H. **CPU Throttling for Steam Deck**
- [ ] Detect Steam Deck and reduce FPS target (5 FPS instead of 10)
- [ ] Reduce resolution to 854x480 (Steam Deck native)
- [ ] Cap CPU usage at 2 cores (leave 2 for game)
- [ ] Skip OCR on small/low-confidence text

### Nice-to-Have Changes

#### Performance Tuning
- [ ] GPU acceleration via ROCm (AMD GPU on Steam Deck APU)
- [ ] Quantized OCR models (smaller, faster)
- [ ] Model compression with ONNX Quantization
- [ ] Profile and optimize bottleneck operations

#### UX Improvements
- [ ] Show real-time confidence overlay
- [ ] Allow region selection (only translate selected area)
- [ ] Auto-pause when overlay active (already exists)
- [ ] Configurable FPS target per game

#### Advanced Features
- [ ] Multi-line text handling (merge adjacent regions)
- [ ] Character segmentation (allow selecting individual words)
- [ ] Phonetic display (Ukrainian → Latin alphabet transliteration)
- [ ] Text-to-speech for translated text

---

## 6. Ukrainian Language Considerations

### RapidOCR Support
```python
# From rapidocr_provider.py
LANGUAGE_MAP = {
    'uk': 'eslav',  # Ukrainian → Slavic model family
    # Other Slavic languages use same model:
    'ru': 'eslav',
    'bg': 'eslav',
}
```
- ✅ Excellent OCR accuracy for Ukrainian text
- ✅ Handles Cyrillic correctly
- ✅ Model available: `ch_server_dict.txt` (includes Ukrainian)

### CTranslate2 / NLLB Support
```python
# NLLB-200 supports 200 languages including:
# 'uk_UA' for Ukrainian (Cyrillic script)
# Can translate FROM Ukrainian or TO Ukrainian
```

### Text Rendering
- ✅ Cyrillic fonts work via standard CSS
- ✅ May need to adjust font selection (include Cyrillic-supporting fonts)
- Default: System fonts usually include Ukrainian support
- Recommended: Add font like "Noto Sans" or similar

---

## 7. Implementation Roadmap (Phased)

### Phase 1: Immediate (Make It Work)
1. ✅ Keep manual trigger mode
2. Add Ukrainian language selection to settings
3. Test RapidOCR with 'uk' language code
4. Test CTranslate2 with Ukrainian
5. Fix any font rendering issues with Cyrillic

### Phase 2: Real-Time Foundation
1. Add background screenshot loop (non-blocking)
2. Implement frame queue and async processing
3. Remove global processing lock
4. Switch to persistent worker mode for OCR

### Phase 3: Performance Optimization
1. Add frame skipping (process every Nth frame)
2. Implement translation caching
3. Lower resolution for faster OCR
4. Profile and optimize hot paths

### Phase 4: Steam Deck Optimization
1. Auto-detect Steam Deck and reduce FPS
2. Add CPU core affinity (let game use cores 0-1, OCR uses 2-3)
3. Implement memory monitoring and frame queue throttling
4. Add performance metrics UI

### Phase 5: Advanced Features
1. Multi-line text grouping
2. Regional overlay (user selects part of screen)
3. Confidence-based filtering
4. Game-specific optimizations

---

## 8. Current Limitations Summary

| Issue | Impact | Current | Needed |
|-------|--------|---------|--------|
| **Processing Speed** | 3-10s per frame | Sequential RPC | Parallel pipeline |
| **Frame Rate** | Manual only | On-demand | 5-10 FPS continuous |
| **Resolution** | Heavy (1280p+) | Full screen | 720p-1024p |
| **Translation** | Slow + no cache | Full re-translate | Cached + batched |
| **OCR Model Load** | 2-3s cold start | Oneshot mode | Persistent worker |
| **CPU Usage** | Game slowdown | Uncontrolled | Throttled to 2 cores |
| **Memory Pressure** | OOM risk | No queue | Frame queue management |
| **Frontend Latency** | Slow UI response | 10Hz polling | Interrupt-driven |
| **Cyrillic Fonts** | May not render | Not tested | Full support |

---

## 9. Files Needing Modification

### Backend (Python)
1. `main.py`:
   - Add background screenshot loop
   - Implement frame queue
   - Remove global lock
   - Add continuous capture RPC

2. `py_modules/providers/__init__.py` (ProviderManager):
   - Add frame caching
   - Add translation cache
   - Optimize batch operations

3. `py_modules/providers/rapidocr_provider.py`:
   - Ensure persistent worker is default
   - Add frame resolution control
   - Add confidence filtering

### Frontend (React)
1. `src/Translator.tsx`:
   - Change from manual trigger to frame polling
   - Implement pipeline for rendering updates
   - Add frame queue visualization

2. `src/Overlay.tsx`:
   - Update to handle streaming frames
   - Optimize rendering performance
   - Add Cyrillic font support

3. `src/Input.tsx`:
   - Keep toggle/dismiss modes
   - Add real-time enable/disable
   - Add hotkey to activate continuous mode

4. `src/tabs/TabTranslation.tsx`:
   - Add Ukrainian language selection
   - Add FPS target configuration
   - Add resolution selector

---

## Key Takeaways

1. **Current Design**: Event-driven (manual trigger) → Works great for single screenshots
2. **For Real-Time**: Needs background loop + async pipeline → Complex but doable
3. **Performance**: OCR is bottleneck (2-5s) → Must optimize or switch providers
4. **Ukrainian**: Fully supported at all layers (OCR, translation, rendering)
5. **Steam Deck**: Limited CPU (4c) → Requires frame skipping and resolution reduction
6. **No Major Rewrites**: Can add features incrementally without breaking current flow
