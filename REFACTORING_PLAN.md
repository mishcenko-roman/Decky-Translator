# Refactoring Plan: Core Architecture Foundation

## 1. EXACT PROBLEMS BLOCKING PROGRESS

### Problem 1: Global `_processing_lock = False` (main.py:96)
**Current Issue:**
```python
_processing_lock = False  # Boolean flag, not a real lock
```
**Why It's Broken:**
- Boolean flag is NOT thread-safe (multiple threads can read/write simultaneously)
- No actual serialization happens (lock is checked but never set atomically)
- Prevents concurrent OCR + translation pipeline
- Can't do real-time: need to process multiple frames while previous frame is translating
- Creates false sense of synchronization (developers think it works)

**Blocking For:**
- Async frame processing pipeline
- Real-time translation during gameplay
- Concurrent OCR + translation operations

---

### Problem 2: Plugin Class is 1800+ Lines (main.py)
**Current Issue:**
- Single class handles: RPC endpoints, settings management, OCR/translation logic, screenshot capture, frame processing, provider configuration, model downloading
- All logic is synchronous or half-async
- No module boundaries for future pipeline features
- Testing is impossible (can't test frame processing without entire Plugin)

**Why It's Broken:**
- Can't add async pipeline without bloating Plugin to 2500+ lines
- Settings scattered: Plugin class + SettingsContext + hardcoded defaults
- RPC methods mixed with internal processing logic
- Adding features requires understanding entire 1800 lines

**Blocking For:**
- Frame caching and pipeline
- Async frame processing
- Settings management refactoring
- Testable components

---

### Problem 3: No Pipeline Module (doesn't exist)
**Current Issue:**
- Frame processor, cache, frame skipper would have to live in Plugin class
- Each feature (cache, skipper, batch processor) bloats Plugin further
- No abstraction for "sequence of frames in → processed frames out"

**Why It's Broken:**
- Can't implement real-time without modularity
- Cache hits/misses not separated from RPC logic
- Frame skipping strategy tied to screenshot timing

**Blocking For:**
- Frame batching and optimization
- Real-time translation pipeline
- Performance tuning (can't benchmark pipeline vs OCR vs rendering)

---

### Problem 4: All Processing is in RPC Methods
**Current Issue:**
- `async def ocr()`, `async def translate()` methods do everything synchronously-ish
- No separation: request handling ≠ actual processing
- Can't rate-limit or queue frames without modifying RPC methods

**Why It's Broken:**
- Each RPC call blocks until complete (no async benefits yet)
- Can't process frame while UI is requesting status
- Adding queue/buffer requires touching RPC layer

---

### Problem 5: ProviderManager is Growing (400+ lines)
**Current Issue:**
- Handles: provider selection, configuration, reachability checks, model downloading, persistent worker management
- Mixed responsibilities: factory pattern + configuration + lifecycle management

**Why It's Broken:**
- Hard to add new providers without understanding entire manager
- Model downloading logic mixed with provider initialization
- Persistent worker management (for async) will make it 600+ lines

**Blocking For:**
- Adding lightweight models (Opus-MT, NLLB-distilled)
- Persistent async worker pools
- Model quantization/optimization

---

## 2. BEST SOLUTION FOR EACH PROBLEM

### Problem 1 Solution: `asyncio.Semaphore` + Proper Lock
**Change:**
```python
# Before
_processing_lock = False

# After
import asyncio
_processing_semaphore = None  # Created on plugin init

async def _initialize_plugin_internals():
    global _processing_semaphore
    _processing_semaphore = asyncio.Semaphore(1)  # Only 1 concurrent operation
```

**Usage:**
```python
async def ocr():
    async with _processing_semaphore:
        # Only 1 OCR at a time
        result = await provider.recognize(image)
    return result
```

**Why This Works:**
- Real atomic locking (asyncio-aware)
- Other tasks can run while lock-holder waits for I/O
- Can transition to `Semaphore(2)` later for concurrent OCR + translation

**Effort:** 2-3 hours
**Risk:** Low (mechanical change, easy to test)

---

### Problem 2 Solution: Split Plugin Into 3 Modules
**Current:** 1800 lines in Plugin class
**New Structure:**

```
py_modules/
├── plugin_rpc.py          # RPC endpoints only (~600 lines)
├── pipeline/
│   ├── __init__.py
│   ├── frame_processor.py # Frame → OCR/Translation
│   ├── cache.py          # Frame hashing + caching
│   └── async_worker.py   # Persistent subprocess workers
└── providers/
    └── __init__.py       # Enhanced ProviderManager
```

**Migration:**
1. Move all RPC methods (`async def ocr()`, `async def translate()`, etc.) → `plugin_rpc.py`
2. Move processing logic (OCR/translation/screenshot) → `pipeline/frame_processor.py`
3. Move caching logic → `pipeline/cache.py`
4. Keep SettingsContext in React (settings are read-only after plugin init)

**What Stays in Plugin:**
```python
class Plugin:
    async def on_load(self):  # Load settings, init semaphore
    async def on_unload(self): # Cleanup
    
    # All RPC methods delegate to rpc module:
    async def ocr(self, ...): 
        return await self.rpc.ocr(...)
```

**Effort:** 2-3 days
**Risk:** Medium (large refactor, but mechanical - no logic changes)

---

### Problem 3 Solution: Create Pipeline Module
**Location:** `py_modules/pipeline/`

**Core Classes:**

```python
# pipeline/frame_processor.py
class FrameProcessor:
    """Async frame → OCR → Translation pipeline."""
    def __init__(self, ocr_provider, translation_provider, cache):
        self.ocr = ocr_provider
        self.translation = translation_provider
        self.cache = cache
    
    async def process_frame(self, image_bytes: bytes, skip_translation=False):
        """Process single frame: OCR + optional translation."""
        # Check cache
        cached = self.cache.get(image_bytes)
        if cached:
            return cached
        
        # OCR
        regions = await self.ocr.recognize(image_bytes)
        
        # Translate
        if not skip_translation:
            for region in regions:
                region.translated_text = await self.translation.translate(
                    region.text, target_lang="en"
                )
        
        # Cache result
        self.cache.set(image_bytes, regions)
        return regions

# pipeline/cache.py
class FrameCache:
    """LRU cache for OCR results."""
    def __init__(self, max_size=50):
        self.cache = {}  # hash → regions
        self.max_size = max_size
    
    def get(self, image_bytes: bytes):
        """Returns cached regions or None."""
        h = self._hash(image_bytes)
        return self.cache.get(h)
    
    def set(self, image_bytes: bytes, regions: List[TextRegion]):
        """Cache OCR result."""
        # LRU eviction if needed
        if len(self.cache) >= self.max_size:
            self.cache.popitem(FIFO)
        h = self._hash(image_bytes)
        self.cache[h] = regions

# pipeline/async_worker.py
class PersistentWorker:
    """Keep OCR/translation process alive between requests."""
    async def start(self, provider_class, **config):
        """Start persistent subprocess."""
        # For RapidOCR, CT2: subprocess keeps model loaded in memory
        # Avoids reload overhead on each request
        self.process = await asyncio.create_subprocess_exec(...)
    
    async def stop(self):
        """Cleanup."""
        self.process.kill()
```

**Effort:** 1 day
**Risk:** Low (self-contained module, no existing code depends on it yet)

---

### Problem 4 Solution: Separate RPC Layer from Processing
**Current:**
```python
async def ocr(self, ...):
    # Everything in one method
    image = await self._capture_screenshot()
    regions = await provider.recognize(image)
    return regions
```

**New:**
```python
# plugin_rpc.py
async def ocr(self, image_bytes: bytes, language: str = "auto"):
    """RPC endpoint - validation only."""
    if not image_bytes:
        raise ValueError("Image required")
    
    # Delegate to processing layer
    return await self.frame_processor.process_frame(image_bytes)

# pipeline/frame_processor.py
async def process_frame(self, image_bytes: bytes):
    """Actual processing - can be tested independently."""
    with self.semaphore:  # Atomic lock
        regions = await self.ocr_provider.recognize(image_bytes)
        return regions
```

**Benefits:**
- RPC methods are thin (5-10 lines)
- Processing logic is testable
- Can rate-limit/queue without touching RPC

**Effort:** Included in Problem 2 solution
**Risk:** Low (clear separation)

---

### Problem 5 Solution: ProviderManager Specialization
**Split Responsibilities:**

```python
# providers/__init__.py
class ProviderManager:
    """Factory: creates OCR/Translation providers."""
    def __init__(self):
        self._ocr_providers = {}
        self._translation_providers = {}
    
    def get_ocr_provider(self, name: str) -> OCRProvider:
        """Get or create OCR provider."""
        if name not in self._ocr_providers:
            self._ocr_providers[name] = self._create_ocr(name)
        return self._ocr_providers[name]

# providers/model_manager.py (NEW)
class ModelManager:
    """Download, cache, and manage models."""
    async def ensure_models(self, provider_name: str):
        """Download if missing, return paths."""
        # Handles RapidOCR models, NLLB models, etc.
        pass

# providers/worker_pool.py (NEW)
class PersistentWorkerPool:
    """Manage long-lived worker processes."""
    async def borrow_worker(self, provider_name: str):
        """Get worker, start if needed."""
        pass
    
    async def return_worker(self, provider_name: str, worker):
        """Return worker to pool."""
        pass
```

**Effort:** 1 day
**Risk:** Low (new modules, old ProviderManager shrinks)

---

## 3. FILES/CLASSES TO SPLIT OR REWRITE

| File | Current Size | Action | New Size |
|------|------|--------|----------|
| `main.py` | 1800+ lines | Split into 3 parts | 800 lines (Plugin only) |
| `py_modules/providers/__init__.py` | 400+ lines | Extract ProviderManager | 200 lines (factory only) |
| `py_modules/providers/base.py` | 100 lines | **KEEP AS-IS** (well-designed) | 100 lines |
| **NEW:** `py_modules/plugin_rpc.py` | — | Create | 200 lines (RPC endpoints) |
| **NEW:** `py_modules/pipeline/frame_processor.py` | — | Create | 100 lines |
| **NEW:** `py_modules/pipeline/cache.py` | — | Create | 80 lines |
| **NEW:** `py_modules/pipeline/async_worker.py` | — | Create | 120 lines |
| **NEW:** `py_modules/providers/model_manager.py` | — | Create | 150 lines |
| **NEW:** `py_modules/providers/worker_pool.py` | — | Create | 100 lines |

---

## 4. RECOMMENDED MODULE STRUCTURE

```
Decky-Translator/
├── main.py                          # Plugin entry point (800 lines)
│   ├── Class Plugin
│   │   ├── async on_load()
│   │   ├── async on_unload()
│   │   └── Thin RPC methods delegate to modules
│
├── py_modules/
│   ├── __init__.py
│   │
│   ├── plugin_rpc.py               # RPC endpoints (200 lines)
│   │   ├── async def ocr()
│   │   ├── async def translate()
│   │   ├── async def get_screenshot()
│   │   └── async def set_settings()
│   │
│   ├── pipeline/                   # Frame processing pipeline
│   │   ├── __init__.py
│   │   ├── frame_processor.py      # Main pipeline (100 lines)
│   │   │   └── class FrameProcessor:
│   │   │       └── async def process_frame()
│   │   ├── cache.py                # Frame LRU cache (80 lines)
│   │   │   └── class FrameCache:
│   │   │       ├── get()
│   │   │       └── set()
│   │   └── async_worker.py         # Persistent workers (120 lines)
│   │       └── class PersistentWorker:
│   │           ├── async def start()
│   │           └── async def stop()
│   │
│   ├── providers/                  # Provider system
│   │   ├── __init__.py            # ProviderManager factory (200 lines)
│   │   │   └── class ProviderManager:
│   │   │       ├── get_ocr_provider()
│   │   │       └── get_translation_provider()
│   │   ├── base.py                # Abstract classes (100 lines) [UNCHANGED]
│   │   ├── model_manager.py       # Model download/cache (150 lines)
│   │   │   └── class ModelManager:
│   │   │       ├── async def ensure_models()
│   │   │       └── async def get_model_path()
│   │   ├── worker_pool.py         # Worker lifecycle (100 lines)
│   │   │   └── class WorkerPool:
│   │   │       ├── async def borrow_worker()
│   │   │       └── async def return_worker()
│   │   ├── rapidocr_provider.py   # [KEEP, may optimize later]
│   │   ├── chromescreenai_provider.py
│   │   ├── google_ocr.py
│   │   └── ... [other providers]
│   │
│   └── settings.py                # Settings schema (NEW, 100 lines)
│       └── class PluginSettings:
│           ├── ocr_provider
│           ├── translation_provider
│           └── from_dict() / to_dict()
│
├── src/                            # React frontend [UNCHANGED]
│   └── SettingsContext.tsx         # Settings are read-only after init
```

**Key Principle:** Separation of concerns
- **main.py:** Plugin lifecycle + thin RPC delegation
- **plugin_rpc.py:** RPC validation + error handling
- **pipeline/:** Frame processing (can test without plugin)
- **providers/:** OCR/translation (unchanged interface)

---

## 5. WHAT SHOULD BECOME ASYNC vs SYNC

### Must Be Async (I/O Bound):
```
✅ OCR operations (can take 500-1000ms)
✅ Translation (can take 100-500ms)
✅ Model downloading (minutes)
✅ Screenshot capture (variable latency)
✅ Network requests (Google, Gemini)
✅ File I/O (cache reads/writes)
```

### Should Stay Sync (CPU Bound, Quick):
```
✅ Frame hashing (microseconds)
✅ Cache lookup (microseconds)
✅ Settings validation (microseconds)
✅ RPC parameter parsing (microseconds)
✅ Frame region formatting (milliseconds)
✅ Logger operations (buffered I/O, fast)
```

### Implementation Pattern:
```python
# RPC layer (async, thin wrapper)
async def ocr(self, image_bytes):
    return await self._processor.process_frame(image_bytes)

# Processing layer (async, does real work)
async def process_frame(self, image_bytes):
    # Sync operations (very fast)
    cached = self._cache.get(image_bytes)  # sync
    if cached:
        return cached
    
    # Async operations (slow)
    regions = await self._ocr_provider.recognize(image_bytes)  # async I/O
    
    # Sync operations (format)
    for r in regions:
        r.confidence_pct = int(r.confidence * 100)  # sync
    
    return regions
```

---

## 6. IMPLEMENTATION ORDER (Critical Sequence)

### Phase 1: Foundation (Prerequisite for everything)
**Duration:** 2-3 hours
**Files:**
1. Replace `_processing_lock` with `asyncio.Semaphore` in main.py
2. Test: Create simple async test that acquires/releases semaphore

**Why First:**
- Unblocks concurrent processing
- All subsequent code assumes proper locking
- Small, mechanical change (low risk)

**Validation:**
```python
# Test that multiple coroutines can wait on semaphore
async def test_semaphore():
    sem = asyncio.Semaphore(1)
    
    async def worker(n):
        async with sem:
            # Should serialize: "work 1 start", "work 1 end", "work 2 start", "work 2 end"
            print(f"work {n} start")
            await asyncio.sleep(0.1)
            print(f"work {n} end")
    
    await asyncio.gather(worker(1), worker(2))
```

---

### Phase 2: Pipeline Module (Self-contained)
**Duration:** 1 day
**Files:**
1. Create `py_modules/pipeline/__init__.py`
2. Create `py_modules/pipeline/cache.py` (FrameCache class)
3. Create `py_modules/pipeline/frame_processor.py` (FrameProcessor class)
4. Create `py_modules/pipeline/async_worker.py` (PersistentWorker class - stub for now)

**Test:**
```python
# Test frame processor without Plugin
from py_modules.pipeline import FrameProcessor, FrameCache
from py_modules.providers import MockOCRProvider

async def test_pipeline():
    cache = FrameCache(max_size=10)
    processor = FrameProcessor(MockOCRProvider(), cache)
    
    # First call: OCR
    result1 = await processor.process_frame(image_bytes)
    
    # Second call with same image: cache hit
    result2 = await processor.process_frame(image_bytes)
    assert result1 == result2  # Same object from cache
```

**Why Second:**
- Doesn't touch existing code (no risk of breaking anything)
- Tests async pipeline in isolation
- Lets us validate design before refactoring Plugin

---

### Phase 3: Provider Refactoring (Non-Breaking)
**Duration:** 1 day
**Files:**
1. Create `py_modules/providers/model_manager.py` (ModelManager class)
2. Create `py_modules/providers/worker_pool.py` (WorkerPool class - stub for now)
3. Refactor `py_modules/providers/__init__.py` (ProviderManager stays same API)

**Why Third:**
- Shrinks ProviderManager without breaking ProviderManager API
- Plugin code doesn't change yet
- Sets up for persistent workers (Phase 4)

---

### Phase 4: Plugin RPC Extraction (Large Refactor)
**Duration:** 2-3 days
**Files:**
1. Create `py_modules/plugin_rpc.py` (move RPC method stubs, no logic yet)
2. Move processing logic from Plugin methods → pipeline/frame_processor
3. Update Plugin.on_load() to initialize pipeline module
4. Update Plugin RPC methods to delegate to pipeline

**Implementation Order (within Phase 4):**
- Copy all RPC method signatures to plugin_rpc.py
- For each RPC method:
  1. Keep validation in RPC layer
  2. Move processing to frame_processor
  3. Have RPC method delegate to frame_processor
  4. Test that RPC method still works
- Once all methods done: delete old processing code from Plugin

**Why Fourth:**
- Depends on Phase 2 (pipeline module exists)
- Large refactor, but well-sequenced (one method at a time)
- Phase 1-3 mean this is mechanical (no new logic needed)

---

### Phase 5: Settings Module (Optional, Cleanup)
**Duration:** 4 hours
**Files:**
1. Create `py_modules/settings.py` (PluginSettings class)
2. Move settings schema from Plugin.__init__ → PluginSettings
3. Simplify Plugin.on_load() to just load PluginSettings

**Why Fifth:**
- Improves code organization but not blocking
- Can defer if time-constrained
- Settings are mostly read-only after init

---

## 7. PERFORMANCE/STABILITY RISKS ON STEAM DECK

### Risk 1: Memory Bloat from Pipeline Module
**Issue:** Adding cache + pipeline adds ~10-20 MB RAM
**Steam Deck Context:** 16 GB RAM total, heavy games use 12+ GB → only 4 GB available
**Mitigation:**
- FrameCache: LRU with max 50 frames (~100 MB for 1080p screenshots) - **TOO LARGE**
- **Solution:** Default to max 10 frames (~20 MB)
- **Solution:** Make cache size configurable (settings)

**Risk Level:** 🟡 MEDIUM
**Action:** Add cache size limit, test on real Steam Deck

---

### Risk 2: Semaphore Overhead
**Issue:** `asyncio.Semaphore(1)` means only 1 operation at a time
**Steam Deck Context:** Can't do concurrent OCR + translation
**Mitigation:**
- Initially: use `Semaphore(1)` (safe, matches current behavior)
- Later: upgrade to `Semaphore(2)` or separate semaphores for OCR/translation
- **Don't block:** This refactoring **improves** concurrency (enables future upgrades)

**Risk Level:** 🟢 LOW
**Action:** Plan future concurrency upgrade (not in this refactoring)

---

### Risk 3: Subprocess Workers (Persistent Mode)
**Issue:** Keeping RapidOCR process alive uses extra RAM (~200 MB)
**Steam Deck Context:** Borderline acceptable
**Mitigation:**
- PersistentWorker: start with opt-in (default: false)
- Don't enable by default until tested on real hardware
- **Solution:** Add setting: `rapidocr_persistent_mode = false`

**Risk Level:** 🟡 MEDIUM
**Action:** Don't enable persistent workers until testing on hardware

---

### Risk 4: Frame Cache Collisions (Hash Misses)
**Issue:** Using simple hash() might cause false cache misses
**Steam Deck Context:** Wastes processing on duplicate frames
**Mitigation:**
- Use SHA-256 hash of image bytes (secure, unique)
- Cost: ~5 ms per frame (acceptable)

**Risk Level:** 🟢 LOW
**Action:** Implement SHA-256 hash in cache.py

---

### Risk 5: Async Event Loop Blocking
**Issue:** If any operation blocks the event loop, whole plugin stalls
**Steam Deck Context:** Would cause UI lag, frame drops
**Mitigation:**
- Add timeout to all async operations
- Log slow operations (>1s)
- Never use `.run_in_executor()` (blocks thread pool)
- **Solution:** Add operation monitor in frame_processor

**Risk Level:** 🔴 HIGH
**Action:** Add timeouts + logging for all async ops

---

### Risk 6: Decky Framework Compatibility
**Issue:** Refactoring might break Decky plugin API
**Steam Deck Context:** Plugin won't load on real Deck
**Mitigation:**
- Don't change Plugin.__init__() signature
- Don't change RPC method signatures
- RPC method names must stay the same

**Risk Level:** 🟢 LOW (if careful)
**Action:** Validate RPC signatures before/after refactor

---

## 8. CHECKLIST FOR SAFE EXECUTION

Before starting each phase:

### Phase 1 (Semaphore):
- [ ] Backup current main.py
- [ ] Replace `_processing_lock = False` → `_processing_semaphore = None`
- [ ] Create async function to initialize semaphore on plugin load
- [ ] Wrap all processing with `async with _processing_semaphore:`
- [ ] Test with pytest: 2 concurrent operations serialize correctly
- [ ] Run plugin on Steam Deck: still works

### Phase 2 (Pipeline):
- [ ] Create py_modules/pipeline/ directory
- [ ] Implement FrameCache with SHA-256 hashing
- [ ] Implement FrameProcessor with OCR + translation
- [ ] Create mock OCR provider for testing
- [ ] Test cache hits/misses independently
- [ ] Test frame processing with real OCR provider
- [ ] Measure cache performance (hit rate, latency)

### Phase 3 (Providers):
- [ ] Create ModelManager (download logic)
- [ ] Create WorkerPool (stub version)
- [ ] Refactor ProviderManager to use ModelManager
- [ ] Ensure ProviderManager API unchanged
- [ ] Test that all providers still initialize
- [ ] Validate model downloads work

### Phase 4 (Plugin RPC):
- [ ] Create plugin_rpc.py with all RPC method stubs
- [ ] For each RPC method:
  - [ ] Move validation logic to RPC layer
  - [ ] Move processing logic to frame_processor
  - [ ] Test RPC method works
  - [ ] Delete old processing code
- [ ] Run full test suite
- [ ] Test on Steam Deck

### Phase 5 (Settings):
- [ ] Create settings.py with PluginSettings class
- [ ] Move settings schema from Plugin
- [ ] Update Plugin.__init__() to load PluginSettings
- [ ] Test settings still load/save
- [ ] Validate frontend still reads settings

---

## 9. SUCCESS CRITERIA

After refactoring, the codebase should:

✅ **Concurrent Processing Ready**
- Multiple async operations can run without blocking each other
- RPC method calls don't block other RPC method calls

✅ **Testable**
- `FrameProcessor` can be tested without Plugin (unit test)
- `ProviderManager` can be tested without Plugin (unit test)
- No global state except semaphore

✅ **Modular**
- Pipeline module is self-contained (can replace with different impl)
- Providers are pluggable (can add new provider without touching Plugin)
- Settings are centralized (one source of truth)

✅ **No Logic Changes**
- Plugin behaves identically before/after refactoring
- RPC method signatures unchanged
- RPC method responses unchanged
- All existing settings/configurations still work

✅ **Performance Foundation**
- Frame caching reduces duplicate OCR
- Proper locking enables future concurrent improvements
- Pipeline module ready for batching, streaming, etc.

✅ **Steam Deck Ready**
- Passes all tests on real hardware
- Memory usage < 5% increase
- No new frame drops or UI lag
- Persistent workers optional (off by default)

---

## RISK SUMMARY

| Phase | Duration | Risk | Breaking Change? |
|-------|----------|------|-------------------|
| 1: Semaphore | 2-3h | 🟢 LOW | No |
| 2: Pipeline Module | 1d | 🟢 LOW | No |
| 3: Provider Refactor | 1d | 🟢 LOW | No |
| 4: Plugin RPC Extract | 2-3d | 🟡 MEDIUM | Only if bugs |
| 5: Settings Module | 4h | 🟢 LOW | No |
| **Total** | **~1 week** | **🟡 MEDIUM overall** | **No if careful** |

---

## NEXT STEPS

1. **Review this plan** - Ensure approach matches project needs
2. **Set up testing** - Create pytest fixtures for Phases 1-2
3. **Start Phase 1** - Replace global lock (safest first step)
4. **Validate on hardware** - Test each phase on real Steam Deck
5. **Document as you go** - Update module docstrings with examples

Once refactoring complete → Ready for real-time translation pipeline implementation.
