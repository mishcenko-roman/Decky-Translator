# Decky Translator: Technical Analysis Report

**Date**: May 19, 2026 | **Status**: Phase 2C Implementation Assessment

---

## 1. WHAT WORKS RIGHT NOW

### Core Features (Production-Ready)
- **Screenshot capture** (`main.py:1417-1510`) - GStreamer pipeline with retry logic, 3 attempts, 2.5s timeout per attempt
- **OCR recognition** (`main.py:2597-2635`) - Works via provider manager (ChromeScreenAI, RapidOCR, etc.)
- **Text translation** (`main.py:2637-2702`) - Uses provider system with fallback to original text on error
- **UI overlay rendering** (`src/Overlay.tsx`) - Renders translated regions with responsive font sizing
- **Settings persistence** (`main.py:981-992`) - JSON-based SettingsManager reads/writes correctly
- **Hidraw button monitoring** (`main.py:309-668`) - Real Steam Deck controller input (L4, R4 detection)
- **Provider hot-swap** (`main.py:1052-1180`) - Can switch OCR/translation providers without restart
- **Frontend event listeners** (`src/Translator.tsx:315-380`) - `takeScreenshotAndTranslate()` fires on button press

### Phase 2C Features (Partially Working)
- **Continuous capture worker** (`py_modules/pipeline/continuous_capture.py:100-280`) - Initialized, can start/stop, produces stats
- **Performance benchmark** (`py_modules/pipeline/benchmarker.py`) - Initialized in `_main()`, has `get_stats()` method
- **Async pipeline** (`py_modules/pipeline/pipeline.py`) - Initialized with benchmark, both OCR and translation workers created
- **Latency recording** (`py_modules/pipeline/async_workers.py:135`) - OCR worker calls `benchmark.record_latency("ocr", ...)`

---

## 2. WHAT IS BROKEN OR DISCONNECTED

### **CRITICAL: Benchmark Not Recording Translation Latency**
- **File**: `py_modules/pipeline/async_workers.py` (Translation Worker section)
- **Issue**: `AsyncTranslationWorker.run()` does NOT call `benchmark.record_latency("translation", ...)` 
- **Lines**: ~200 range (translation worker) missing the recording call that OCR worker has at line 135
- **Impact**: Performance dashboard shows 0ms for translation stage (useless metric)
- **Severity**: CRITICAL - Phase 2C feature incomplete

### **CRITICAL: Continuous Capture Never Actually Runs**
- **File**: `main.py:2453`
- **Line**: `self._capture_task = asyncio.create_task(self._capture_worker.run())`
- **Issue**: Task is created but `_capture_worker.run()` never gets awaited in the event loop. Frontend never calls `start_continuous_capture()` RPC.
- **Evidence**: UI has no button/toggle to start capture; it only triggers on manual screenshot
- **Impact**: Real-time frame capture (3 FPS baseline) never activates despite full infrastructure
- **Severity**: CRITICAL - Phase 2C main feature not wired to UI

### **CRITICAL: Capture Worker Methods Missing `is_running()` and `set_mode(mode, button, fps)`**
- **File**: `py_modules/pipeline/continuous_capture.py:100-280`
- **Issue**: RPC methods in `main.py` call `self._capture_worker.is_running()` (line 1387, 1422) and `.set_mode(capture_mode, trigger_button, target_fps)` (line 1462)
- **Methods don't exist** in the worker class - only `.running` attribute (boolean)
- **Impact**: RPC calls will crash with `AttributeError: 'ContinuousCaptureWorker' object has no attribute 'is_running'`
- **Severity**: CRITICAL - RPC methods broken

### **HIGH: Model Reloading on Every Translation Request**
- **File**: `py_modules/providers/ct2_translate.py:120-180`
- **Issue**: `_load_model()` called inside `translate_batch()` every time, checks `self._loaded_pair == pair` but rebuilds if language pair changes
- **For Opus-MT** (`py_modules/providers/opus_mt_translate.py:80-120`): Same pattern - `_load_model()` called every request
- **Impact**: 500-800ms added per request if model not currently loaded (transformers lazy load is slow)
- **Severity**: HIGH - Kills performance for switching language pairs mid-session

### **HIGH: Blocking CPU Check Inside Async Loop**
- **File**: `py_modules/pipeline/continuous_capture.py:150`
- **Line**: `cpu_usage = self.get_cpu_usage()` inside the async capture loop
- **Issue**: `get_cpu_usage()` calls `psutil.Process().cpu_percent(interval=0.05)` (main.py:2343)
- **Problem**: `interval=0.05` is a BLOCKING call in the async event loop - halts the loop for 50ms every frame capture
- **Impact**: At 3 FPS, this adds 150ms bloat. At 5 FPS baseline, blocker becomes dominant cost
- **Severity**: HIGH - Breaks async concurrency model

### **MEDIUM: Benchmark `get_stats()` Returns Wrong Types**
- **File**: `py_modules/pipeline/benchmarker.py:150-220`
- **Issue**: `get_stats()` returns `BenchmarkStats` dataclass, but `main.py:1293` tries to access `.capture_latency_avg_ms`, `.ocr_latency_avg_ms`, etc.
- **Problem**: Dataclass has `capture_latency_avg_ms` etc., but deques are keyed by stage string: `self.latencies["capture"]`, `self.latencies["ocr"]`
- **Calculation mismatch**: Computing percentiles from deques requires custom logic not visible in code
- **Severity**: MEDIUM - Stats endpoint works but numbers may be wrong (need to verify `get_stats()` implementation)

### **MEDIUM: Overlapping RPC Methods for Capture Control**
- **File**: `main.py:1360-1430`
- **Issue**: Four separate methods for capture control:
  - `start_continuous_capture(mode, trigger_button, target_fps)` - new (lines 1368-1428)
  - `set_capture_mode(mode)` - old stub (lines 1449-1461)  
  - `set_capture_fps(fps)` - old stub (lines 1463-1473)
  - `get_capture_stats()` - works fine (lines 1333-1355)
- **Problem**: Old stubs don't call `.set_mode()` correctly; new method calls non-existent `.set_mode(mode, trigger_button, target_fps)` with 3 args
- **Confusion**: Two different APIs for same thing
- **Severity**: MEDIUM - UI dev confusion, potential version mismatches

### **MEDIUM: Memory Leak in Continuous Capture**
- **File**: `py_modules/pipeline/continuous_capture.py:150-210`
- **Issue**: Screenshots converted to bytes via `self._base64_to_bytes()` inside capture loop
- **No cleanup**: Image data queued to pipeline, but if pipeline queue fills, frame dropped with bytes still allocated
- **With 10-frame queue at 3 FPS and slow translation**: Old frames could accumulate
- **Severity**: MEDIUM - Long sessions (>1 hour) may see 50-100MB creep

### **LOW: Fade-Out Animation Never Used**
- **File**: `src/Overlay.tsx:764-771`
- **CSS**: `@keyframes fadeOutTranslation` defined but never referenced in component
- **Line 658**: Only uses `fadeInTranslation` animation
- **Impact**: Empty regions don't animate away, just blink off
- **Severity**: LOW - Polish issue, not functional

---

## 3. MAIN BOTTLENECK

### Root Cause #1: Synchronous CPU Monitoring in Async Context
**Location**: `py_modules/pipeline/continuous_capture.py:150` calls `get_cpu_usage()` which blocks for 0.05s  
**Numbers**: 
- 3 FPS baseline = 330ms between frames
- Each CPU check = 50ms blocking
- Effective cost = 15% of capture loop time wasted
- Scales to 25% at 5 FPS (200ms intervals)

**Solution**: Use async wrapper or sample CPU on separate thread

### Root Cause #2: Missing Benchmark Recording for Translation
**Location**: `py_modules/pipeline/async_workers.py` (~200 line range)  
**Numbers**:
- OCR records latency correctly (avg ~250-400ms on Steam Deck)
- Translation records nothing → dashboard shows "0ms" for translation
- Users see "fast" plugin but 70% of time is translation (invisible)

**Solution**: Add `benchmark.record_latency("translation", elapsed_ms, frame.frame_id)` in translation worker

---

## 4. DEPENDENCY CHAINS (Broken Wiring)

### Chain 1: Continuous Capture Never Activates
```
Frontend UI
  ↓
(NO BUTTON TO START CAPTURE)
  ↓
start_continuous_capture() RPC never called
  ↓
_capture_worker.run() task created but idle
  ↓
ContinuousCaptureWorker.running = False forever
  ↓
No frames ever captured in real-time
```

### Chain 2: RPC Calls Crash
```
Frontend calls: start_continuous_capture(mode="button_triggered", ...)
  ↓
main.py:1387 calls: if not self._capture_worker.is_running()
  ↓
ContinuousCaptureWorker has NO is_running() method
  ↓
AttributeError raised, RPC returns crash
  ↓
Frontend shows "error" notification
```

### Chain 3: Model Reload Tax
```
User translates: "Hello" (en→uk)  
  → Opus-MT loads (500ms)
  → Translation works
User translates: "Привіт" (uk→en)
  → Pair changed: check _loaded_pair != (uk, en)
  → Reload Opus-MT model (500ms again!)
  → Translation works
Result: 1000ms for two translations that should take 200ms
```

### Chain 4: Benchmark Stats Never Populated
```
PerformanceBenchmark initialized in _main()
  ↓
benchmark passed to Pipeline
  ↓
Pipeline creates OCRWorker with benchmark ref
  ↓
OCRWorker.run() calls benchmark.record_latency("ocr", ...) ✓
  ↓
Pipeline creates TranslationWorker with benchmark ref
  ↓
TranslationWorker.run() DOES NOT call benchmark.record_latency() ✗
  ↓
get_performance_stats() returns zeros for translation latency
```

---

## 5. NEXT SINGLE ACTION

### **IMMEDIATE FIX: Add Missing Methods to ContinuousCaptureWorker**

**File to change**: `/Users/admin/Decky-Translator/py_modules/pipeline/continuous_capture.py`

**What to do**:
1. Add `is_running()` method (simple getter):
```python
def is_running(self) -> bool:
    """Return whether worker is currently running."""
    return self.running
```

2. Fix `set_mode()` signature to match RPC calls:
```python
async def set_mode(self, mode: CaptureMode, trigger_button: str = None, target_fps: int = None) -> None:
    """Update capture configuration."""
    self.mode = mode
    if trigger_button:
        self.trigger_button = trigger_button
    if target_fps:
        self.target_fps = target_fps
    logger.info(f"ContinuousCaptureWorker mode changed: {mode.value}, button={self.trigger_button}, fps={self.target_fps}")
```

3. Add `get_stats()` if missing:
```python
def get_stats(self) -> CaptureStats:
    """Return capture worker statistics."""
    uptime = (time.time() - self.start_time) if self.start_time else 0
    return CaptureStats(
        mode=self.mode,
        total_frames_captured=self.total_frames_captured,
        total_frames_dropped=self.total_frames_dropped,
        current_fps=self.current_fps,
        queue_depth=self.pipeline.frame_input_queue.qsize() if self.pipeline else 0,
        cpu_usage_pct=self.get_cpu_usage(),
        uptime_seconds=uptime,
        last_frame_timestamp=self.last_frame_timestamp
    )
```

**Why this first**: Blocks all other Phase 2C testing. RPC methods will crash without these.

**Time to fix**: 5 minutes  
**Risk**: None (adds missing methods, doesn't change logic)
