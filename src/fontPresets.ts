import { createElement, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DropdownOption } from "@decky/ui";

export const DEFAULT_TRANSLATED_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export type FontStyleOption = 'normal' | 'bold' | 'italic' | 'bolditalic';

const FONT_STYLE_CSS: Record<FontStyleOption, { fontWeight: string; fontStyle: string }> = {
    normal:     { fontWeight: '400', fontStyle: 'normal' },
    bold:       { fontWeight: '700', fontStyle: 'normal' },
    italic:     { fontWeight: '400', fontStyle: 'italic' },
    bolditalic: { fontWeight: '700', fontStyle: 'italic' },
};

/** Resolve FontStyleOption into CSS fontWeight + fontStyle values. */
export function resolveFontStyleCSS(style: FontStyleOption) {
    return FONT_STYLE_CSS[style] || FONT_STYLE_CSS.normal;
}

export function quoteFontName(fontName: string): string {
    return `'${fontName.replace(/'/g, "\\'")}'`;
}

// Local font families to probe for availability on the system
export const LOCAL_FONT_CANDIDATES: string[] = [
    'DejaVu Serif',
    'DejaVu Sans',
    'DejaVu Sans Mono',
    'Noto Serif',
    'Noto Sans',
    'Noto Sans Mono',
];

// Curated list of Google Fonts with Cyrillic + Latin-ext support.
// Used as the default for Latin/Cyrillic languages.
export const WEB_FONTS: string[] = [
    'Open Sans',
    'Montserrat',
    'Nunito',
    'Raleway',
    'Exo 2',
    'Roboto Slab',
    'Merriweather',
    'Lora',
    'Russo One',
    'Press Start 2P',
    'Caveat',
    'Shantell Sans',
];

// Language-specific web font lists for scripts that need dedicated fonts.
// Each entry maps a target language code to its own curated list.
export const LANGUAGE_WEB_FONTS: Record<string, string[]> = {
    ja: ['Potta One', 'Hachi Maru Pop', 'Yuji Mai', 'DotGothic16', 'Zen Antique'], // Japanese
    ko: ['Gamja Flower', 'Jua', 'Song Myung'], // Korean
    'zh-CN': ['Noto Serif Simplified Chinese', 'ZCOOL QingKe HuangYou', 'Long Cang'], // Chinese Simplified
    'zh-TW': ['Noto Serif Traditional Chinese', 'Potta One', 'DotGothic16'], // Chinese Traditional
    th: ['Noto Serif Thai', 'Playpen Sans Thai', 'Itim'], // Thai
    hi: ['Noto Serif Devanagari', 'Kalam', 'Kurale'], // Hindi
    ar: ['Noto Nastaliq Urdu', 'Changa', 'Rakkas'], // Arabic
    el: ['Open Sans', 'Roboto Slab', 'Press Start 2P', 'Playpen Sans'], // Greek
};

/** Return the web font list appropriate for the given target language. */
export function getWebFontsForLanguage(targetLanguage: string): string[] {
    return LANGUAGE_WEB_FONTS[targetLanguage] ?? WEB_FONTS;
}

const allWebFontSet = new Set<string>([...WEB_FONTS, ...Object.values(LANGUAGE_WEB_FONTS).flat()]);

/** Check whether the font is a web font (in any language list). */
export function isWebFont(fontName: string): boolean {
    return allWebFontSet.has(fontName);
}

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

const GFONTS_LINK_PREFIX = 'decky-translator-gfont-';
const loadedWebFonts = new Set<string>();

/** Load a Google Font by injecting a <link> stylesheet. */
export function loadGoogleFont(fontName: string): Promise<boolean> {
    if (loadedWebFonts.has(fontName)) return Promise.resolve(true);

    const id = GFONTS_LINK_PREFIX + fontName.replace(/\s+/g, '-');
    if (document.getElementById(id)) {
        loadedWebFonts.add(fontName);
        return Promise.resolve(true);
    }

    const familyParam = fontName.replace(/\s+/g, '+');
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@400;700&display=swap`;
    document.head.appendChild(link);

    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            if (ok) {
                loadedWebFonts.add(fontName);
            } else {
                link.remove();
            }
            resolve(ok);
        };
        link.onload = () => {
            if (document.fonts?.ready) {
                document.fonts.ready.then(() => finish(true));
            } else {
                setTimeout(() => finish(true), 500);
            }
        };
        link.onerror = () => finish(false);
        setTimeout(() => finish(false), 6000);
    });
}

/** Preload web fonts for the given list so they render in the dropdown immediately. */
export function preloadWebFontList(fonts: string[]): void {
    for (const f of fonts) {
        loadGoogleFont(f);
    }
}

export function resolveTranslatedFontFamily(selectedFontFamily: string): string {
    const normalizedSelection = selectedFontFamily?.trim();

    if (!normalizedSelection) {
        return DEFAULT_TRANSLATED_FONT_FAMILY;
    }

    if (isWebFont(normalizedSelection)) {
        loadGoogleFont(normalizedSelection);
    } else {
        ensureFontFaceRegistered(normalizedSelection);
    }

    return `${quoteFontName(normalizedSelection)}, ${DEFAULT_TRANSLATED_FONT_FAMILY}`;
}

/** Hook that detects local/web fonts and builds a dropdown options list. */
export function useFontOptions(selectedFontFamily: string, targetLanguage: string, onFontReset?: () => void) {
    const [availableFonts, setAvailableFonts] = useState<string[]>([]);

    useEffect(() => {
        const detected = detectAvailableFonts(LOCAL_FONT_CANDIDATES);
        ensureAllFontFaces(detected);
        setAvailableFonts(Array.from(detected).sort((a, b) => a.localeCompare(b)));
    }, []);

    const webFonts = useMemo(() => getWebFontsForLanguage(targetLanguage), [targetLanguage]);

    const fontOptions = useMemo(() => {
        const localSet = new Set(availableFonts);
        const webOnly = webFonts.filter(f => !localSet.has(f)).sort((a, b) => a.localeCompare(b));

        const styledLabel = (text: string, fontFamily: string): ReactNode =>
            createElement('span', { style: { fontFamily: `${quoteFontName(fontFamily)}, sans-serif` } }, text);

        const options: DropdownOption[] = [
            { label: "Auto (System Default)", data: "" },
        ];

        if (selectedFontFamily && !localSet.has(selectedFontFamily) && !webOnly.includes(selectedFontFamily)) {
            options.push({ label: styledLabel(selectedFontFamily, selectedFontFamily), data: selectedFontFamily });
        }

        if (availableFonts.length > 0) {
            options.push({
                label: "Local Fonts",
                options: availableFonts.map(f => ({ label: styledLabel(f, f), data: f })),
            });
        }

        if (webOnly.length > 0) {
            options.push({
                label: "Web Fonts",
                options: webOnly.map(f => ({ label: styledLabel(f, f), data: f })),
            });
        }

        return options;
    }, [availableFonts, selectedFontFamily, webFonts]);

    // Reset font to Auto when target language changes and current font is not in the new list
    const prevLangRef = useRef(targetLanguage);
    useEffect(() => {
        if (prevLangRef.current === targetLanguage) return;
        prevLangRef.current = targetLanguage;
        if (selectedFontFamily && !webFonts.includes(selectedFontFamily) && !availableFonts.includes(selectedFontFamily)) {
            onFontReset?.();
        }
    }, [targetLanguage]);

    const preloadedLangRef = useRef<string>('');
    const preloadWebFonts = useCallback(() => {
        if (preloadedLangRef.current !== targetLanguage) {
            preloadedLangRef.current = targetLanguage;
            preloadWebFontList(getWebFontsForLanguage(targetLanguage));
        }
    }, [targetLanguage]);

    return { availableFonts, webFonts, fontOptions, preloadWebFonts };
}
