import type { DropdownOption } from "@decky/ui";
import { createElement, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isDyslexiaFont, getDyslexiaFontsForLanguage, loadDyslexiaFont, preloadDyslexiaFonts, getDyslexiaCssUrls } from "./dyslexiaFonts";
import { getWebFontsForLanguage, isWebFont, loadGoogleFont, preloadWebFontList } from "./webFonts";
import { FONT_CACHE_INDICATOR_COLOR, getCachedFontNames, cacheFontToDisk, loadFontFromCache } from "./fontCache";
import { logger } from "../Logger";
import { useRealOnlineStatus } from "./hooks/useRealOnlineStatus";

export const DEFAULT_TRANSLATED_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export type FontStyleOption = 'normal' | 'bold' | 'italic' | 'bolditalic';

const FONT_STYLE_CSS: Record<FontStyleOption, { fontWeight: string; fontStyle: string }> = {
    normal:     { fontWeight: '400', fontStyle: 'normal' },
    bold:       { fontWeight: '700', fontStyle: 'normal' },
    italic:     { fontWeight: '400', fontStyle: 'italic' },
    bolditalic: { fontWeight: '700', fontStyle: 'italic' },
};

export function resolveFontStyleCSS(style: FontStyleOption) {
    return FONT_STYLE_CSS[style] || FONT_STYLE_CSS.normal;
}

export function quoteFontName(fontName: string): string {
    return `'${fontName.replace(/'/g, "\\'")}'`;
}

export const LOCAL_FONT_CANDIDATES: string[] = [
    'DejaVu Serif',
    'DejaVu Sans',
    'DejaVu Sans Mono',
    'Noto Serif',
    'Noto Sans',
    'Noto Sans Mono',
];

/** Canvas-based font detection: compares pixel widths with a known fallback. */
function isFontAvailableCanvas(fontName: string): boolean {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        const testString = 'mmmmmmmmmmlli1|WMwij#@';
        const size = '72px';
        const baseFonts = ['monospace', 'sans-serif', 'serif'] as const;
        const quoted = quoteFontName(fontName);

        for (const base of baseFonts) {
            ctx.font = `${size} ${base}`;
            const baseWidth = ctx.measureText(testString).width;
            ctx.font = `${size} ${quoted}, ${base}`;
            const testWidth = ctx.measureText(testString).width;
            if (Math.abs(baseWidth - testWidth) > 0.1) return true;
        }
        return false;
    } catch {
        return false;
    }
}

export function detectAvailableFonts(fontCandidates: string[]): Set<string> {
    const detected = new Set<string>();
    for (const fontName of fontCandidates) {
        if (isFontAvailableCanvas(fontName)) {
            detected.add(fontName);
        }
    }
    return detected;
}

// Steam's CEF may not expose system fonts unless they are explicitly
// declared through @font-face with a local() src.

const STYLE_ID = 'decky-translator-font-faces';

function getOrCreateStyleSheet(): HTMLStyleElement {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    return el;
}

const injectedFonts = new Set<string>();

/** Inject a @font-face local() rule so CEF can resolve the font. No-op if already injected. */
export function ensureFontFaceRegistered(fontName: string): void {
    if (!fontName || injectedFonts.has(fontName)) return;
    const style = getOrCreateStyleSheet();
    const escaped = fontName.replace(/'/g, "\\'");
    style.textContent += `\n@font-face { font-family: '${escaped}'; src: local('${escaped}'); }`;
    injectedFonts.add(fontName);
}

export function ensureAllFontFaces(fonts: Iterable<string>): void {
    for (const f of fonts) ensureFontFaceRegistered(f);
}

export function cleanupFontFaces(): void {
    document.getElementById(STYLE_ID)?.remove();
    injectedFonts.clear();
}

/** Build translated text font-family CSS value. */
export function buildTranslatedFontFamily(selectedFontFamily: string): string {
    const normalizedSelection = selectedFontFamily?.trim();
    if (!normalizedSelection) return DEFAULT_TRANSLATED_FONT_FAMILY;
    return `${quoteFontName(normalizedSelection)}, ${DEFAULT_TRANSLATED_FONT_FAMILY}`;
}

/** Ensure selected font is available (cache/network/local). */
export function ensureFontLoaded(selectedFontFamily: string): Promise<boolean> {
    const normalizedSelection = selectedFontFamily?.trim();
    if (!normalizedSelection) return Promise.resolve(false);

    if (isDyslexiaFont(normalizedSelection)) {
        return loadDyslexiaFont(normalizedSelection).catch((e) => {
            logger.error('FontPresets', `Failed to load dyslexia font "${normalizedSelection}"`, e);
            return false;
        });
    } else if (isWebFont(normalizedSelection)) {
        return loadGoogleFont(normalizedSelection).catch((e) => {
            logger.error('FontPresets', `Failed to load web font "${normalizedSelection}"`, e);
            return false;
        });
    } else {
        ensureFontFaceRegistered(normalizedSelection);
        return Promise.resolve(true);
    }
}

/** Track readiness of currently selected translated text font. */
export function useFontReady(selectedFontFamily: string): boolean {
    const [fontReady, setFontReady] = useState(false);

    useEffect(() => {
        let isActive = true;
        setFontReady(false);

        const normalizedSelection = selectedFontFamily?.trim();
        if (!normalizedSelection) {
            setFontReady(true);
            return () => {
                isActive = false;
            };
        }

        ensureFontLoaded(normalizedSelection).then((ok) => {
            if (!isActive) return;
            setFontReady(ok);
            logger.debug('FontPresets', `Font "${normalizedSelection}" ensureLoaded result: ${ok}`);
        });

        return () => {
            isActive = false;
        };
    }, [selectedFontFamily]);

    return fontReady;
}

export function useFontOptions(selectedFontFamily: string, targetLanguage: string, onFontReset?: () => void) {
    const [availableFonts, setAvailableFonts] = useState<string[]>([]);
    const [cachedFonts, setCachedFonts] = useState<Set<string>>(new Set());
    const isOnline = useRealOnlineStatus();

    useEffect(() => {
        const detected = detectAvailableFonts(LOCAL_FONT_CANDIDATES);
        ensureAllFontFaces(detected);
        setAvailableFonts(Array.from(detected).sort((a, b) => a.localeCompare(b)));
    }, []);

    // Inject cached font CSS before updating dropdown state to avoid first-paint fallback labels.
    const refreshCachedFonts = useCallback(() => {
        getCachedFontNames().then(async (names) => {
            if (names.size > 0) {
                await Promise.all(
                    Array.from(names).map(fontName => loadFontFromCache(fontName).catch(() => false))
                );
            }
            setCachedFonts(names);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        refreshCachedFonts();
    }, [refreshCachedFonts]);

    const webFonts = useMemo(() => getWebFontsForLanguage(targetLanguage), [targetLanguage]);
    const dyslexiaFonts = useMemo(() => getDyslexiaFontsForLanguage(targetLanguage), [targetLanguage]);

    const fontOptions = useMemo(() => {
        const localSet = new Set(availableFonts);
        const dyslexiaSet = new Set(dyslexiaFonts);
        const webOnly = webFonts.filter(f => !localSet.has(f) && !dyslexiaSet.has(f)).sort((a, b) => a.localeCompare(b));

        const visibleDyslexia = isOnline ? dyslexiaFonts : dyslexiaFonts.filter(f => cachedFonts.has(f));
        const visibleWeb = isOnline ? webOnly : webOnly.filter(f => cachedFonts.has(f));

        const cachedDot = () => createElement('span', {
            style: { fontSize: '10px', flexShrink: 0, color: FONT_CACHE_INDICATOR_COLOR }
        }, '●');

        const styledLabel = (text: string, fontFamily: string, showCached: boolean): ReactNode =>
            createElement('span', {
                style: { fontFamily: `${quoteFontName(fontFamily)}, sans-serif`, display: 'flex', alignItems: 'center', gap: '6px' }
            },
                text,
                showCached ? cachedDot() : null
            );

        const groupLabel = (text: string, allCached: boolean): ReactNode =>
            allCached
                ? createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, text, cachedDot())
                : text;

        const options: DropdownOption[] = [
            { label: "Auto (System Default)", data: "" },
        ];

        if (selectedFontFamily && !localSet.has(selectedFontFamily) && !visibleWeb.includes(selectedFontFamily) && !visibleDyslexia.includes(selectedFontFamily)) {
            if (isOnline || cachedFonts.has(selectedFontFamily)) {
                options.push({ label: styledLabel(selectedFontFamily, selectedFontFamily, isOnline && cachedFonts.has(selectedFontFamily)), data: selectedFontFamily });
            }
        }

        if (availableFonts.length > 0) {
            options.push({
                label: "Local Fonts",
                options: availableFonts.map(f => ({ label: styledLabel(f, f, false), data: f })),
            });
        }

        if (visibleDyslexia.length > 0) {
            const allDyslexiaCached = visibleDyslexia.every(f => cachedFonts.has(f));
            options.push({
                label: groupLabel("Dyslexia-Friendly", isOnline && allDyslexiaCached),
                options: visibleDyslexia.map(f => ({
                    label: styledLabel(f, f, isOnline && !allDyslexiaCached && cachedFonts.has(f)),
                    data: f,
                })),
            });
        }

        if (visibleWeb.length > 0) {
            const allWebCached = visibleWeb.every(f => cachedFonts.has(f));
            options.push({
                label: groupLabel("Web Fonts", isOnline && allWebCached),
                options: visibleWeb.map(f => ({
                    label: styledLabel(f, f, isOnline && !allWebCached && cachedFonts.has(f)),
                    data: f,
                })),
            });
        }

        return options;
    }, [availableFonts, selectedFontFamily, webFonts, dyslexiaFonts, cachedFonts, isOnline]);

    // Reset to Auto when language changes and current font is unavailable.
    const prevLangRef = useRef(targetLanguage);
    useEffect(() => {
        if (prevLangRef.current === targetLanguage) return;
        prevLangRef.current = targetLanguage;
        if (selectedFontFamily && !webFonts.includes(selectedFontFamily) && !availableFonts.includes(selectedFontFamily) && !dyslexiaFonts.includes(selectedFontFamily)) {
            onFontReset?.();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs only on language change
    }, [targetLanguage]);

    // Reset to Auto when going offline if current remote font is not cached.
    const prevOnlineRef = useRef(isOnline);
    useEffect(() => {
        const wasOnline = prevOnlineRef.current;
        prevOnlineRef.current = isOnline;
        if (wasOnline && !isOnline && selectedFontFamily && isRemoteFont(selectedFontFamily) && !cachedFonts.has(selectedFontFamily)) {
            onFontReset?.();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs only on online state change
    }, [isOnline]);

    const preloadedLangRef = useRef<string>('');
    const preloadWebFonts = useCallback(() => {
        if (preloadedLangRef.current !== targetLanguage) {
            preloadedLangRef.current = targetLanguage;
            preloadWebFontList(getWebFontsForLanguage(targetLanguage));
            preloadDyslexiaFonts(targetLanguage);
        }
    }, [targetLanguage]);

    const fontDescription = useMemo(() => {
        const webCount = webFonts.filter(f => !availableFonts.includes(f)).length;
        return `${availableFonts.length} local + ${webCount} web`
            + (dyslexiaFonts.length > 0 ? ` + ${dyslexiaFonts.length} dyslexia` : '')
            + ' fonts';
    }, [availableFonts, webFonts, dyslexiaFonts]);

    return { availableFonts, webFonts, dyslexiaFonts, cachedFonts, fontOptions, fontDescription, preloadWebFonts, refreshCachedFonts };
}

export function isRemoteFont(fontName: string): boolean {
    return isWebFont(fontName) || isDyslexiaFont(fontName);
}

export function loadRemoteFont(fontName: string, options: { allowAutoCache?: boolean } = {}): Promise<boolean> {
    if (isDyslexiaFont(fontName)) return loadDyslexiaFont(fontName, options);
    if (isWebFont(fontName)) return loadGoogleFont(fontName, options);
    return Promise.resolve(false);
}

/** Load a remote font and wait until its cache write completes. */
export async function downloadAndCacheRemoteFont(fontName: string): Promise<boolean> {
    const loaded = await loadRemoteFont(fontName, { allowAutoCache: false });
    if (!loaded) return false;

    let cssUrls: string[] | undefined;
    if (isDyslexiaFont(fontName)) {
        cssUrls = getDyslexiaCssUrls(fontName);
    } else if (isWebFont(fontName)) {
        const familyParam = fontName.replace(/\s+/g, '+');
        cssUrls = [`https://fonts.googleapis.com/css2?family=${familyParam}:wght@400;700&display=swap`];
    }

    if (cssUrls?.length) {
        await cacheFontToDisk(fontName, cssUrls);
    }
    return true;
}
