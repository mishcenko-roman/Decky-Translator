# Step-by-Step Implementation Plan: Real-Time Ukrainian Translation Overlay

## Overview
Transform Decky Translator from **manual-trigger screenshot tool** to **live-streaming text detection and translation system** while maintaining low CPU usage on Steam Deck.

---

## Phase 1: Foundation - Enable Continuous Frame Capture (Week 1)

### Goal
Get screenshot loop running in background without blocking anything.

### Step 1.1: Create Background Screenshot Loop (Backend)

**File**: `main.py`

Add to `Plugin` class:

```python
class Plugin:
    def __init__(self, *args, **kwargs):
        # ... existing init ...
        self._screenshot_loop_running = False
        self._screenshot_loop_thread = None
        self._current_frame_data = None  # Latest frame base64
        self._frame_queue = asyncio.Queue(maxsize=3)  # Async queue for frames
        self._frame_lock = threading.Lock()
        
    async def start_background_loop(self):
        """Start continuous screenshot capture loop"""
        if self._screenshot_loop_running:
            logger.warning("Screenshot loop already running")
            return False
        
        self._screenshot_loop_running = True
        self._screenshot_loop_thread = threading.Thread(
            target=self._screenshot_loop_worker,
            daemon=True
        )
        self._screenshot_loop_thread.start()
        logger.info("Background screenshot loop started")
        return True
    
    async def stop_background_loop(self):
        """Stop the background loop gracefully"""
        self._screenshot_loop_running = False
        if self._screenshot_loop_thread:
            self._screenshot_loop_thread.join(timeout=5.0)
        logger.info("Background screenshot loop stopped")
        return True
    
    def _screenshot_loop_worker(self):
        """Worker thread: capture frames at target FPS"""
        FRAME_INTERVAL = 0.2  # 5 FPS (200ms between frames)
        
        while self._screenshot_loop_running:
            try:
                start_time = time.time()
                
                # Take screenshot (blocking, but in separate thread)
                screenshot_path = self._take_screenshot_internal()
                
                if screenshot_path:
                    # Encode to base64
                    with open(screenshot_path, 'rb') as f:
                        img_bytes = f.read()
                    base64_data = base64.b64encode(img_bytes).decode('utf-8')
                    
                    # Store in atomic variable
                    with self._frame_lock:
                        self._current_frame_data = base64_data
                    
                    # Try to add to queue (drop if full)
                    try:
                        asyncio.run_coroutine_threadsafe(
                            self._frame_queue.put(base64_data),
                            asyncio.get_event_loop()
                        )
                    except asyncio.QueueFull:
                        logger.debug("Frame queue full, dropping frame")
                    
                    # Clean up temp file
                    try:
                        os.remove(screenshot_path)
                    except:
                        pass
                
                # Sleep to maintain FPS
                elapsed = time.time() - start_time
                sleep_time = max(0, FRAME_INTERVAL - elapsed)
                time.sleep(sleep_time)
                
            except Exception as e:
                logger.error(f"Screenshot loop error: {e}")
                time.sleep(0.5)
    
    def _take_screenshot_internal(self) -> Optional[str]:
        """Internal screenshot function (same as take_screenshot but no lock)"""
        # Reuse existing GStreamer pipeline code but return path instead of base64
        # ... implementation similar to take_screenshot() ...
        pass
    
    async def get_current_frame(self) -> str:
        """Get the latest captured frame"""
        with self._frame_lock:
            return self._current_frame_data or ""
    
    async def get_frame_stream(self):
        """Async generator for streaming frames"""
        while self._screenshot_loop_running:
            try:
                frame = await asyncio.wait_for(
                    self._frame_queue.get(),
                    timeout=1.0
                )
                yield frame
            except asyncio.TimeoutError:
                continue
```

### Step 1.2: Create Frame Queue Manager (Backend)

**File**: `main.py`

```python
class FrameProcessor:
    """Manages async processing of frames"""
    
    def __init__(self):
        self._pending_ocr = []  # List of (frame_id, base64_data)
        self._ocr_results = {}  # frame_id -> text_regions
        self._pending_translation = []
        self._translation_results = {}  # frame_id -> translated regions
        self._lock = threading.Lock()
        self._frame_counter = 0
    
    async def enqueue_frame(self, base64_data: str) -> int:
        """Add frame to processing queue"""
        with self._lock:
            frame_id = self._frame_counter
            self._frame_counter += 1
            self._pending_ocr.append((frame_id, base64_data))
        return frame_id
    
    async def process_ocr(self, provider_manager, language: str = 'auto'):
        """Process pending OCR requests"""
        if not self._pending_ocr:
            return
        
        frame_id, base64_data = self._pending_ocr.pop(0)
        
        try:
            image_bytes = base64.b64decode(base64_data)
            regions = await provider_manager.recognize_text(
                image_bytes,
                language=language
            )
            self._ocr_results[frame_id] = regions
        except Exception as e:
            logger.error(f"Frame {frame_id} OCR error: {e}")
            self._ocr_results[frame_id] = []
    
    async def process_translation(self, provider_manager, 
                                 source_lang: str, target_lang: str):
        """Process pending translation requests"""
        # Similar structure for translation
        pass
```

### Step 1.3: Add UI Toggle for Continuous Mode (Frontend)

**File**: `src/Translator.tsx`

```typescript
export class GameTranslatorLogic {
    private continuousModeEnabled = false;
    
    async enableContinuousMode(): Promise<void> {
        if (this.continuousModeEnabled) return;
        this.continuousModeEnabled = true;
        
        try {
            await call('start_background_loop');
            this.startFramePolling();
            logger.info('Translator', 'Continuous mode enabled');
        } catch (error) {
            logger.error('Translator', 'Failed to enable continuous mode', error);
            this.continuousModeEnabled = false;
        }
    }
    
    async disableContinuousMode(): Promise<void> {
        this.continuousModeEnabled = false;
        await call('stop_background_loop');
        logger.info('Translator', 'Continuous mode disabled');
    }
    
    private startFramePolling(): void {
        const pollInterval = setInterval(async () => {
            if (!this.continuousModeEnabled) {
                clearInterval(pollInterval);
                return;
            }
            
            try {
                // Get latest frame
                const frameData = await call('get_current_frame');
                if (!frameData) return;
                
                // Show frame immediately (no wait for OCR)
                this.imageState.showImage(frameData);
                
                // Start OCR in background
                this.performOCROnFrame(frameData);
            } catch (error) {
                logger.error('Translator', 'Frame polling error', error);
            }
        }, 200); // Poll every 200ms
    }
    
    private async performOCROnFrame(frameData: string): Promise<void> {
        // Call OCR but don't wait for it
        try {
            const regions = await call('recognize_text', frameData);
            
            // Only update if we're still in continuous mode
            if (!this.continuousModeEnabled) return;
            
            // Perform translation
            const translatedRegions = await this.textTranslator.translateText(regions);
            
            // Update overlay
            this.imageState.showTranslatedImage(frameData, translatedRegions);
        } catch (error) {
            logger.error('Translator', 'OCR/Translation error', error);
        }
    }
}
```

### Step 1.4: Add Settings Toggle

**File**: `src/tabs/TabMain.tsx`

Add switch:
```typescript
<ToggleField 
    label="Real-Time Mode"
    description="Enable continuous screen text detection"
    checked={settings.continuousMode}
    onChange={(checked) => {
        // Call logic.enableContinuousMode() or disableContinuousMode()
    }}
/>
```

**Success Criteria:**
- [ ] Backend captures screenshots continuously at 5 FPS
- [ ] Frontend shows latest frame with <200ms latency
- [ ] OCR runs asynchronously in background
- [ ] No stuttering in game or plugin UI
- [ ] Can toggle on/off without crash

---

## Phase 2: Remove Blocking Global Lock (Week 1-2)

### Goal
Allow multiple frames to be processed without blocking.

### Step 2.1: Remove `_processing_lock` from `main.py`

Currently: Only one screenshot can process at a time
Change to: Allow up to N frames in parallel (N = number of cores - 1)

```python
# BEFORE
_processing_lock = False

async def take_screenshot(self):
    global _processing_lock
    if _processing_lock:
        raise RuntimeError("Screenshot already in progress")
    _processing_lock = True
    try:
        # ... do work ...
    finally:
        _processing_lock = False

# AFTER
class ProcessingSlots:
    def __init__(self, max_concurrent=2):
        self._semaphore = asyncio.Semaphore(max_concurrent)
    
    async def __aenter__(self):
        await self._semaphore.acquire()
        return self
    
    async def __aexit__(self, *args):
        self._semaphore.release()

_processing_slots = ProcessingSlots(max_concurrent=2)

async def take_screenshot(self):
    async with _processing_slots:
        # ... do work ...
```

**Success Criteria:**
- [ ] Can process 2+ OCR requests simultaneously
- [ ] Frame queue no longer drops frames due to lock
- [ ] CPU stays at reasonable levels

---

## Phase 3: Optimize OCR for Speed (Week 2)

### Goal
Reduce OCR latency from 2-5s to 1-2s.

### Step 3.1: Enable Persistent Worker Mode

**File**: `main.py` plugin initialization

```python
def __init__(self, *args, **kwargs):
    # ... existing code ...
    
    # Configure providers for real-time
    self._provider_manager.set_rapidocr_persistent_mode(True)
    self._provider_manager.set_chromescreenai_persistent_mode(True)
    self._provider_manager.set_ct2_persistent_mode(True)
```

**Impact**: ~200ms faster per OCR (skips Python startup + model load)

### Step 3.2: Lower Default Resolution

**File**: `main.py`

Modify GStreamer pipeline to downscale:

```python
cmd = (
    f"GST_PLUGIN_PATH={GSTPLUGINSPATH} "
    f"LD_LIBRARY_PATH={DEPSPATH} "
    f"gst-launch-1.0 -e "
    f"pipewiresrc do-timestamp=true num-buffers=5 ! "
    f"videoscale ! video/x-raw,width=1024,height=768 ! "  # Downscale
    f"videoconvert ! "
    f"pngenc snapshot=true ! "
    f"filesink location=\"{screenshot_path}\""
)
```

**Impact**: Reduces image size by ~4x, OCR 2-3x faster

### Step 3.3: Add Frame Skipping Option

**File**: `src/tabs/TabMain.tsx`

```typescript
<SliderField 
    label="Processing FPS"
    description="How many frames to process per second (5 FPS = skip some frames)"
    min={1}
    max={10}
    value={settings.processingFps}
    onChange={setProcessingFps}
/>
```

Backend implementation: Skip N frames between processing.

**Success Criteria:**
- [ ] OCR latency <2s per frame
- [ ] Persistent worker actually persists (don't respawn)
- [ ] Resolution change doesn't break OCR accuracy too much

---

## Phase 4: Implement Translation Caching (Week 2-3)

### Goal
Avoid re-translating same text across frames.

### Step 4.1: Create Translation Cache

**File**: `py_modules/providers/__init__.py`

```python
class TranslationCache:
    def __init__(self, max_size=1000, ttl_seconds=600):
        self._cache = {}  # (text_hash, source_lang, target_lang) -> translation
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._timestamps = {}
        self._lock = threading.Lock()
    
    def get(self, text: str, source_lang: str, target_lang: str) -> Optional[str]:
        """Get cached translation, return None if expired or missing"""
        key = (hash(text), source_lang, target_lang)
        
        with self._lock:
            if key not in self._cache:
                return None
            
            if time.time() - self._timestamps[key] > self._ttl:
                del self._cache[key]
                return None
            
            return self._cache[key]
    
    def put(self, text: str, source_lang: str, target_lang: str, translation: str):
        """Cache a translation"""
        key = (hash(text), source_lang, target_lang)
        
        with self._lock:
            if len(self._cache) >= self._max_size:
                # Remove oldest entry
                oldest = min(
                    ((k, self._timestamps[k]) for k in self._cache),
                    key=lambda x: x[1]
                )[0]
                del self._cache[oldest]
                del self._timestamps[oldest]
            
            self._cache[key] = translation
            self._timestamps[key] = time.time()
    
    async def batch_translate_with_cache(self, 
                                        texts: List[str],
                                        source_lang: str,
                                        target_lang: str,
                                        provider) -> List[str]:
        """Translate texts, using cache where possible"""
        results = [None] * len(texts)
        needs_translation = []
        indices_needing_translation = []
        
        # Check cache
        for i, text in enumerate(texts):
            cached = self.get(text, source_lang, target_lang)
            if cached:
                results[i] = cached
            else:
                needs_translation.append(text)
                indices_needing_translation.append(i)
        
        # Translate uncached
        if needs_translation:
            translated = await provider.translate(
                needs_translation,
                source_lang=source_lang,
                target_lang=target_lang
            )
            
            # Update cache and results
            for idx, text, translation in zip(
                indices_needing_translation,
                needs_translation,
                translated
            ):
                self.put(text, source_lang, target_lang, translation)
                results[idx] = translation
        
        return results
```

### Step 4.2: Integrate Cache into Provider Manager

**File**: `py_modules/providers/__init__.py`

```python
class ProviderManager:
    def __init__(self):
        # ... existing code ...
        self._translation_cache = TranslationCache(max_size=5000)
    
    async def translate_text(self, texts: List[str], 
                            source_lang: str = "auto", 
                            target_lang: str = "en") -> List[str]:
        """Translate with caching"""
        provider = self.get_translation_provider()
        return await self._translation_cache.batch_translate_with_cache(
            texts,
            source_lang,
            target_lang,
            provider
        )
```

**Expected Impact**: 
- First frame: Full processing (3-10s)
- Subsequent frames with same text: Cache hits reduce translation to <100ms
- Real-time games: 60-80% cache hit rate expected

**Success Criteria:**
- [ ] Cache hits verified in logs
- [ ] Same text blocks translate instantly
- [ ] Cache size stays under 50MB

---

## Phase 5: Add Ukrainian Language Support (Week 3)

### Goal
Ensure Ukrainian is fully supported and tested at all layers.

### Step 5.1: Verify RapidOCR Ukrainian Support

**File**: `py_modules/providers/rapidocr_provider.py`

```python
# Verify mapping exists
assert 'uk' in self.LANGUAGE_MAP
assert self.LANGUAGE_MAP['uk'] == 'eslav'

# Test
async def test_ukrainian_ocr():
    provider = RapidOCRProvider()
    test_image = ...  # Ukrainian text image
    regions = await provider.recognize('uk')
    assert len(regions) > 0
```

### Step 5.2: Configure CTranslate2 for Ukrainian

**File**: `py_modules/providers/ct2_translate.py`

```python
# Verify NLLB has Ukrainian
SUPPORTED_LANGUAGES = {
    'uk': 'uk_UA',  # Ukrainian
    ...
}

# Test
async def test_ukrainian_translation():
    provider = CT2TranslateProvider()
    text = "Привіт"  # "Hello" in Ukrainian
    result = await provider.translate([text], 'uk', 'en')
    assert result[0].lower() == 'hello'
```

### Step 5.3: Update UI Settings

**File**: `src/SettingsContext.tsx`

```typescript
const LANGUAGE_OPTIONS = {
    'uk': 'Українська (Ukrainian)',
    'en': 'English',
    'fr': 'Français',
    ...
}
```

**File**: `src/tabs/TabTranslation.tsx`

```typescript
<DropdownField 
    label="Target Language"
    options={LANGUAGE_OPTIONS}
    value={settings.targetLanguage}
    onChange={setTargetLanguage}
/>

<DropdownField 
    label="Source Language (OCR)"
    description="Use 'Auto' to detect automatically"
    options={{ 'auto': 'Auto-detect', ...LANGUAGE_OPTIONS }}
    value={settings.ocrLanguage}
    onChange={setOCRLanguage}
/>
```

### Step 5.4: Add Cyrillic Font Support

**File**: `src/fonts/webFonts.ts`

```typescript
export const WEB_FONTS: FontPreset[] = [
    {
        name: 'Noto Sans',
        url: 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700',
        family: 'Noto Sans',
        variants: ['normal', 'bold']
    },
    {
        name: 'Noto Sans Cyrillic',
        url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Cyrillic:wght@400;700',
        family: 'Noto Sans Cyrillic',
        variants: ['normal', 'bold']
    },
    // Include more Cyrillic-friendly fonts
];
```

**File**: `src/Overlay.tsx` - Font rendering

```typescript
buildTranslatedFontFamily(fontStyle: FontStyleOption): string {
    // Ensure Cyrillic fonts come first in fallback chain
    const cyrillicFonts = ['Noto Sans Cyrillic', 'Liberation Sans', 'Verdana'];
    const latinFonts = ['Noto Sans', 'Arial', 'sans-serif'];
    
    return [...cyrillicFonts, ...latinFonts].join(', ');
}
```

**Success Criteria:**
- [ ] Ukrainian OCR text detected correctly
- [ ] Translation from/to Ukrainian works
- [ ] Cyrillic text renders in overlay
- [ ] All providers tested with Ukrainian samples

---

## Phase 6: Steam Deck Optimization (Week 3-4)

### Goal
Keep CPU usage low enough that game still runs smoothly.

### Step 6.1: Detect Steam Deck and Apply Presets

**File**: `main.py`

```python
def is_steam_deck() -> bool:
    """Detect if running on Steam Deck"""
    try:
        with open('/etc/os-release') as f:
            content = f.read().lower()
            return 'steamos' in content
    except:
        return False

if is_steam_deck():
    # Apply Steam Deck presets
    DEFAULT_FRAME_INTERVAL = 0.5  # 2 FPS instead of 5
    DEFAULT_RESOLUTION = (854, 480)  # Native Steam Deck
    DEFAULT_OCR_CONFIDENCE = 0.6
    DEFAULT_SKIP_FRAMES = 2  # Process every 3rd frame
```

### Step 6.2: Add CPU Core Affinity

**File**: `py_modules/providers/rapidocr_subprocess.py`

```python
import os

def set_cpu_affinity():
    """Limit OCR to cores 2-3, leave 0-1 for game"""
    try:
        os.sched_setaffinity(0, {2, 3})  # Set affinity to cores 2-3
        logger.info("Set OCR process affinity to cores 2-3")
    except Exception as e:
        logger.warning(f"Failed to set CPU affinity: {e}")

# Call in worker startup
if is_steam_deck():
    set_cpu_affinity()
```

### Step 6.3: Implement Smart Frame Skipping

**File**: `main.py`

```python
class SmartFrameSkipper:
    def __init__(self, steam_deck=False):
        self.skip_count = 2 if steam_deck else 0
        self.frame_number = 0
    
    def should_process(self) -> bool:
        """Check if this frame should be processed"""
        self.frame_number += 1
        return self.frame_number % (self.skip_count + 1) == 0
```

### Step 6.4: Memory Pressure Monitoring

**File**: `main.py`

```python
class MemoryMonitor:
    def __init__(self, max_usage_percent=80):
        self.max_percent = max_usage_percent
    
    def check(self) -> float:
        """Return current memory usage percentage"""
        import psutil
        return psutil.virtual_memory().percent
    
    def should_drop_frame(self) -> bool:
        """Drop frames if memory pressure is high"""
        return self.check() > self.max_percent
```

**Success Criteria:**
- [ ] <30% CPU usage during translation (game runs at 60 FPS)
- [ ] No memory spikes causing OOM
- [ ] Frame queue doesn't back up
- [ ] Auto-detection of Steam Deck works

---

## Phase 7: Frontend Rendering Optimization (Week 4)

### Goal
Render overlay smoothly with minimal React re-renders.

### Step 7.1: Optimize Overlay Rendering

**File**: `src/Overlay.tsx`

```typescript
// Use memo to prevent unnecessary re-renders
const TextOverlayRegion = memo(({ 
    region, 
    fontScale, 
    fontFamily, 
    fontSize 
}: Props) => {
    // Only re-render if region changes
    return (
        <div
            style={{
                position: 'absolute',
                left: `${region.rect.left}px`,
                top: `${region.rect.top}px`,
                maxWidth: `${region.rect.right - region.rect.left}px`,
                background: `rgba(0, 0, 0, 0.7)`,
                color: '#fff',
                padding: '2px 4px',
                fontSize: `${fontSize * fontScale}px`,
                fontFamily: fontFamily,
                wordWrap: 'break-word',
                zIndex: 10000,
            }}
        >
            {region.translatedText}
        </div>
    );
}, (prev, next) => {
    // Custom equality check - skip re-render if text hasn't changed
    return prev.region.translatedText === next.region.translatedText
        && prev.fontScale === next.fontScale;
});

// Batch render updates
const ImageOverlay = memo(({ regions, ...props }: Props) => {
    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {regions.map((region, idx) => (
                <TextOverlayRegion 
                    key={`${idx}-${region.text}`} 
                    region={region} 
                    {...props}
                />
            ))}
        </div>
    );
}, (prev, next) => {
    // Only re-render if number of regions changed or content changed
    if (prev.regions.length !== next.regions.length) return false;
    return prev.regions.every((r, i) => 
        r.translatedText === next.regions[i].translatedText
    );
});
```

### Step 7.2: Limit Rendered Regions

**File**: `src/Overlay.tsx`

```typescript
const MAX_REGIONS_TO_RENDER = 20;

function filterAndSortRegions(regions: TranslatedRegion[]): TranslatedRegion[] {
    return regions
        .filter(r => r.confidence >= 0.4)  // High confidence only
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_REGIONS_TO_RENDER);
}
```

### Step 7.3: Use OffscreenCanvas for Batch Operations

**File**: `src/Overlay.tsx`

```typescript
async function renderOverlayBatch(
    baseImage: string,
    regions: TranslatedRegion[],
    fontFamily: string
): Promise<string> {
    const canvas = new OffscreenCanvas(1920, 1080);
    const ctx = canvas.getContext('2d');
    
    // Draw regions in batch
    for (const region of regions) {
        ctx.font = `16px ${fontFamily}`;
        ctx.fillText(
            region.translatedText,
            region.rect.left,
            region.rect.top
        );
    }
    
    return await canvas.convertToBlob().then(blob => 
        URL.createObjectURL(blob)
    );
}
```

**Success Criteria:**
- [ ] Overlay renders at 60 FPS
- [ ] No UI thread jank
- [ ] React profiler shows <16ms render time
- [ ] Update only affected regions

---

## Phase 8: Integration & Testing (Week 4-5)

### Step 8.1: Integration Testing

**Test Cases:**
1. [ ] Continuous mode toggle on/off
2. [ ] Frame capture at 5 FPS (or lower on Steam Deck)
3. [ ] OCR processes frames without blocking UI
4. [ ] Translation cache works (measure cache hits)
5. [ ] Overlay updates smoothly with new translations
6. [ ] Ukrainian text displays correctly
7. [ ] Memory usage stays <500MB
8. [ ] CPU usage <30% during processing

### Step 8.2: Performance Profiling

```bash
# Profile backend
python -m cProfile main.py

# Profile frontend (in Decky DevTools)
// Chrome profiler in plugin developer tools
```

### Step 8.3: User Testing

Test scenarios:
1. [ ] Game with lots of text (visual novel)
2. [ ] Game with UI-only text (RPG menus)
3. [ ] Fast-paced game (should not interfere with gameplay)
4. [ ] Test Ukrainian OCR + translation with real Ukrainian text
5. [ ] Test on actual Steam Deck hardware

---

## Phase 9: Advanced Optimizations (Week 5+, Optional)

### Future Enhancements (If needed)

#### GPU Acceleration
```python
# Use ROCm for ONNX Runtime
export ONNXRUNTIME_EXECUTION_PROVIDERS=RocmExecutionProvider
# Only on Steam Deck with GPU support
```

#### Quantization
```bash
# Convert ONNX models to INT8 for faster inference
python -m onnxruntime.transformers.onnx_model_optimizer \
  --input_model model.onnx \
  --output_model model_quantized.onnx
```

#### Multi-Language OCR
```python
# If English + Ukrainian simultaneous detection
# Use multilingual model instead of language-specific
```

#### Selective Region Processing
```typescript
// User can select area of screen to monitor
// Reduces processing load significantly
```

---

## Success Metrics

By end of Phase 8, verify:

| Metric | Target | Measure |
|--------|--------|---------|
| **Screenshot Latency** | <500ms | Time from trigger to image displayed |
| **OCR Latency** | <2s | Time to detect all text regions |
| **Translation Latency** | <1s (cached) | Time to translate (with cache) |
| **Frame Rate** | 5-10 FPS | Frames processed per second |
| **CPU Usage** | <30% | Top command while processing |
| **Memory Usage** | <500MB | Process RSS memory |
| **Cache Hit Rate** | >60% | Percent of translations from cache |
| **Ukrainian Accuracy** | >85% | OCR confidence for Cyrillic text |
| **Overlay Latency** | <100ms | Time from translation to render |

---

## Rollback Plan

If any phase fails:
1. Disable continuous mode (keep manual mode working)
2. Revert to previous git commit
3. Document issue in GitHub
4. Adjust approach for next iteration

All phases are additive - never breaking the existing manual trigger mode.

---

## Time Estimate

- **Phase 1**: 3-5 days (continuous loop + frame queue)
- **Phase 2**: 1-2 days (remove lock)
- **Phase 3**: 2-3 days (OCR optimization)
- **Phase 4**: 2-3 days (translation caching)
- **Phase 5**: 2-3 days (Ukrainian support)
- **Phase 6**: 3-4 days (Steam Deck optimization)
- **Phase 7**: 2-3 days (frontend optimization)
- **Phase 8**: 3-5 days (testing + profiling)
- **Phase 9**: Ongoing (advanced features)

**Total**: 4-6 weeks for MVP real-time Ukrainian overlay

---

## Key Files to Modify Summary

| Phase | File | Type | Complexity |
|-------|------|------|------------|
| 1 | main.py | Backend | Medium |
| 1 | Translator.tsx | Frontend | Medium |
| 2 | main.py | Backend | Low |
| 3 | main.py, rapidocr_provider.py | Backend | Low |
| 4 | __init__.py (providers) | Backend | Medium |
| 5 | All provider files, UI files | Both | Low |
| 6 | main.py, rapidocr_subprocess.py | Backend | Medium |
| 7 | Overlay.tsx, TextTranslator.tsx | Frontend | Medium |
| 8 | Test files (new) | Testing | Medium |

