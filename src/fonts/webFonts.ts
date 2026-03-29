import { loadFontFromCache, cacheFontToDisk, isAutoCacheEnabled } from "./fontCache";
import { logger } from "../Logger";

// Curated list of Google Fonts with Cyrillic + Latin-ext support.
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

export function getWebFontsForLanguage(targetLanguage: string): string[] {
    return LANGUAGE_WEB_FONTS[targetLanguage] ?? WEB_FONTS;
}

const allWebFontSet = new Set<string>([...WEB_FONTS, ...Object.values(LANGUAGE_WEB_FONTS).flat()]);

export function isWebFont(fontName: string): boolean {
    return allWebFontSet.has(fontName);
}

const GFONTS_LINK_PREFIX = 'decky-translator-gfont-';
export const GOOGLE_FONT_TIMEOUT_MS = 6000;
const loadedWebFonts = new Set<string>();

interface LoadWebFontOptions {
    allowAutoCache?: boolean;
}

export function injectStylesheetLink(id: string, href: string, timeoutMs: number): Promise<boolean> {
    if (document.getElementById(id)) return Promise.resolve(true);

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);

    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            if (!ok) link.remove();
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
        setTimeout(() => finish(false), timeoutMs);
    });
}

export function loadGoogleFont(fontName: string, options: LoadWebFontOptions = {}): Promise<boolean> {
    const shouldAutoCache = options.allowAutoCache ?? true;
    if (loadedWebFonts.has(fontName)) {
        logger.debug('WebFonts', `Font "${fontName}" already loaded (in-memory set)`);
        return Promise.resolve(true);
    }

    const familyParam = fontName.replace(/\s+/g, '+');
    const cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@400;700&display=swap`;

    // Try persistent disk cache first.
    return loadFontFromCache(fontName).then(cached => {
        if (cached) {
            logger.debug('WebFonts', `Font "${fontName}" loaded from disk cache`);
            loadedWebFonts.add(fontName);
            return true;
        }
        logger.debug('WebFonts', `Font "${fontName}" not in cache, trying network...`);
        const id = GFONTS_LINK_PREFIX + fontName.replace(/\s+/g, '-');
        return injectStylesheetLink(id, cssUrl, GOOGLE_FONT_TIMEOUT_MS).then(ok => {
            if (ok) {
                loadedWebFonts.add(fontName);
                if (shouldAutoCache && isAutoCacheEnabled()) cacheFontToDisk(fontName, [cssUrl]).catch(() => {});
            } else {
                logger.debug('WebFonts', `Font "${fontName}" failed to load from network`);
            }
            return ok;
        });
    });
}

export function preloadWebFontList(fonts: string[]): void {
    for (const f of fonts) {
        loadGoogleFont(f, { allowAutoCache: false }).catch(() => {});
    }
}

export function cleanupWebFonts(): void {
    document.querySelectorAll(`[id^="${GFONTS_LINK_PREFIX}"]`).forEach(el => el.remove());
    loadedWebFonts.clear();
}

/** Reset in-memory loaded state without touching DOM nodes. */
export function resetLoadedWebFontsMemory(): void {
    loadedWebFonts.clear();
}
