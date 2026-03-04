// Persistent font cache via backend APIs.

import { call } from "@decky/api";
import { logger } from "../Logger";

export const FONT_CACHE_INDICATOR_COLOR = '#44A0F7';

const CACHE_STYLE_PREFIX = 'decky-translator-fontcache-';
const injectedCacheStyles = new Set<string>();
const blobUrls = new Map<string, string>();
const pendingLoads = new Map<string, Promise<boolean>>();
let _autoCacheEnabled = false;
let _fontCacheInitialized = false;

/** Fallback timeout for blob <link> load events (ms). */
const BLOB_LOAD_TIMEOUT_MS = 2000;

/** Toggle background font caching. */
export function setAutoCacheEnabled(enabled: boolean): void { _autoCacheEnabled = enabled; }

/** Whether background font caching is enabled. */
export function isAutoCacheEnabled(): boolean { return _autoCacheEnabled; }

/** Initialize cache mode and preload cached fonts.
 *
 * Idempotent: subsequent calls only update the autoCacheEnabled flag and
 * ensure the selected font is injected — they skip the expensive
 * preloadAllCachedFonts() backend round-trip that already ran on first init.
 * Call cleanupCachedFontStyles() to reset the guard (e.g. on plugin unload).
 */
export async function initializeFontCache(
    autoCacheEnabled: boolean,
    selectedFont: string,
): Promise<void> {
    setAutoCacheEnabled(autoCacheEnabled);
    try {
        if (selectedFont) {
            await loadFontFromCache(selectedFont);
        }
        if (_fontCacheInitialized) {
            logger.debug('FontCache', 'initializeFontCache: already initialised, skipping preload');
            return;
        }
        _fontCacheInitialized = true;
        await preloadAllCachedFonts();
    } catch (e) {
        logger.error('FontCache', 'Failed to initialize cached fonts', e);
    }
}

/** Force font decode in the browser font engine. */
async function forceBrowserFontLoad(fontName: string): Promise<void> {
    if (!document.fonts?.load) return;
    const specs = [
        `400 16px '${fontName}'`,
        `700 16px '${fontName}'`,
    ];
    for (const spec of specs) {
        try { await document.fonts.load(spec); } catch { /* weight not in font */ }
    }
    logger.debug('FontCache', `document.fonts.load() completed for "${fontName}"`);
}

/** Load font CSS from persistent cache and ensure decode. */
export async function loadFontFromCache(fontName: string): Promise<boolean> {
    const styleId = CACHE_STYLE_PREFIX + fontName.replace(/\s+/g, '-');

    if (injectedCacheStyles.has(fontName) || document.getElementById(styleId)) {
        logger.debug('FontCache', `Font "${fontName}" already injected — ensuring browser decoded it`);
        await forceBrowserFontLoad(fontName);
        return true;
    }

    const pending = pendingLoads.get(fontName);
    if (pending) return pending;

    const loadPromise = (async (): Promise<boolean> => {
        try {
            logger.debug('FontCache', `Loading cached CSS for "${fontName}"...`);
            const css = await call<[string], string>('get_cached_font_css', fontName);
            if (!css) {
                logger.debug('FontCache', `No cached CSS found for "${fontName}" (empty response)`);
                return false;
            }

            logger.debug('FontCache', `Got cached CSS for "${fontName}": ${css.length} chars`);

            // Use <link>+Blob to trigger the normal stylesheet/font repaint path.
            const blob = new Blob([css], { type: 'text/css' });
            const blobUrl = URL.createObjectURL(blob);
            blobUrls.set(fontName, blobUrl);

            const link = document.createElement('link');
            link.id = styleId;
            link.rel = 'stylesheet';
            link.href = blobUrl;
            (link as HTMLElement).dataset.fontname = fontName;

            await new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };
                link.onload = finish;
                link.onerror = () => {
                    logger.error('FontCache', `<link> failed to load blob CSS for "${fontName}"`);
                    // Release the blob URL immediately to avoid a memory leak —
                    // the load failed so this URL will never be used again.
                    URL.revokeObjectURL(blobUrl);
                    blobUrls.delete(fontName);
                    finish();
                };
                setTimeout(finish, BLOB_LOAD_TIMEOUT_MS);
                document.head.appendChild(link);
            });

            injectedCacheStyles.add(fontName);
            await forceBrowserFontLoad(fontName);

            return true;
        } catch (e) {
            logger.error('FontCache', `Failed to load cached font "${fontName}"`, e);
            return false;
        } finally {
            pendingLoads.delete(fontName);
        }
    })();

    pendingLoads.set(fontName, loadPromise);
    return loadPromise;
}

/** Persist remote font CSS/assets for offline use. */
export async function cacheFontToDisk(fontName: string, cssUrls: string[]): Promise<boolean> {
    try {
        const result = await call<[string, string[]], { success: boolean; error?: string }>('cache_font', fontName, cssUrls);
        return result?.success ?? false;
    } catch {
        return false;
    }
}

/** Check whether font data exists in the on-disk cache. */
export async function isFontCached(fontName: string): Promise<boolean> {
    try {
        return await call<[string], boolean>('is_font_cached', fontName);
    } catch {
        return false;
    }
}

export interface FontCacheInfo {
    totalFonts: number;
    totalSizeBytes: number;
    fonts: { name: string; cachedAt: string; sizeBytes: number }[];
}

/** Return cache stats. */
export async function getFontCacheInfo(): Promise<FontCacheInfo> {
    try {
        return await call<[], FontCacheInfo>('get_font_cache_info');
    } catch {
        return { totalFonts: 0, totalSizeBytes: 0, fonts: [] };
    }
}

/** Delete cached fonts from disk, optionally preserving a subset. */
export async function clearFontCache(excludeFonts?: string[]): Promise<boolean> {
    try {
        const ok = await call<[string[]], boolean>('clear_font_cache', excludeFonts ?? []);
        const excludeSet = new Set(excludeFonts ?? []);
        document.querySelectorAll(`[id^="${CACHE_STYLE_PREFIX}"]`).forEach(el => {
            const fontName = (el as HTMLElement).dataset.fontname
                ?? el.id.replace(CACHE_STYLE_PREFIX, '').replace(/-/g, ' ');
            if (!excludeSet.has(fontName)) {
                el.remove();
                const blobUrl = blobUrls.get(fontName);
                if (blobUrl) {
                    URL.revokeObjectURL(blobUrl);
                    blobUrls.delete(fontName);
                }
            }
        });
        for (const name of injectedCacheStyles) {
            if (!excludeSet.has(name)) injectedCacheStyles.delete(name);
        }
        return ok;
    } catch {
        return false;
    }
}

/** Return cached font names (without size calculation). */
export async function getCachedFontNames(): Promise<Set<string>> {
    try {
        const names = await call<[], string[]>('get_cached_font_names');
        logger.debug('FontCache', `Cached font names from backend: [${(names || []).join(', ')}]`);
        return new Set(names || []);
    } catch (e) {
        logger.error('FontCache', 'Failed to get cached font names', e);
        return new Set();
    }
}

/** Preload all cached fonts into DOM. */
export async function preloadAllCachedFonts(): Promise<Set<string>> {
    try {
        const names = await getCachedFontNames();
        if (names.size === 0) return names;

        logger.debug('FontCache', `Preloading ${names.size} cached font(s): [${Array.from(names).join(', ')}]`);
        const results = await Promise.all(
            Array.from(names).map(async (fontName) => {
                const ok = await loadFontFromCache(fontName);
                return { fontName, ok };
            })
        );
        const succeeded = results.filter(r => r.ok).length;
        logger.info('FontCache', `Preloaded ${succeeded}/${names.size} cached font(s)`);
        return names;
    } catch (e) {
        logger.error('FontCache', 'Failed to preload cached fonts', e);
        return new Set();
    }
}

/** Remove cache-injected styles from DOM (disk data is kept). */
export function cleanupCachedFontStyles(): void {
    document.querySelectorAll(`[id^="${CACHE_STYLE_PREFIX}"]`).forEach(el => el.remove());
    injectedCacheStyles.clear();
    pendingLoads.clear();
    _fontCacheInitialized = false;
    for (const url of blobUrls.values()) {
        URL.revokeObjectURL(url);
    }
    blobUrls.clear();
}
