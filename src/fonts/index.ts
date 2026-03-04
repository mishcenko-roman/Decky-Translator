// fonts/index.ts - Barrel export for font modules

export { isDyslexiaFont, getDyslexiaFontsForLanguage, loadDyslexiaFont, preloadDyslexiaFonts, cleanupDyslexiaFonts, resetLoadedDyslexiaFontsMemory } from "./dyslexiaFonts";
export { WEB_FONTS, LANGUAGE_WEB_FONTS, getWebFontsForLanguage, isWebFont, loadGoogleFont, preloadWebFontList, cleanupWebFonts, resetLoadedWebFontsMemory } from "./webFonts";
export {
    DEFAULT_TRANSLATED_FONT_FAMILY,
    resolveFontStyleCSS,
    quoteFontName,
    LOCAL_FONT_CANDIDATES,
    detectAvailableFonts,
    ensureFontFaceRegistered,
    ensureAllFontFaces,
    buildTranslatedFontFamily,
    ensureFontLoaded,
    useFontReady,
    useFontOptions,
    isRemoteFont,
    loadRemoteFont,
    downloadAndCacheRemoteFont,
    cleanupFontFaces,
} from "./fontPresets";
export type { FontStyleOption } from "./fontPresets";
export { useFontCacheControls } from "./hooks/useFontCacheControls";
export { useTranslatedTextFontChange } from "./hooks/useTranslatedTextFontChange";
export type { FontCacheControls, FontCacheControlsState, FontCacheControlsDerived, FontCacheControlsActions } from "./hooks/useFontCacheControls";
export {
    FONT_CACHE_INDICATOR_COLOR,
    loadFontFromCache,
    cacheFontToDisk,
    isFontCached,
    getFontCacheInfo,
    clearFontCache,
    getCachedFontNames,
    cleanupCachedFontStyles,
    setAutoCacheEnabled,
    preloadAllCachedFonts,
    initializeFontCache,
} from "./fontCache";
export type { FontCacheInfo } from "./fontCache";

import { cleanupWebFonts } from "./webFonts";
import { cleanupDyslexiaFonts } from "./dyslexiaFonts";
import { cleanupFontFaces } from "./fontPresets";
import { cleanupCachedFontStyles } from "./fontCache";

/** Remove all font-related <style> and <link> elements injected by the plugin. */
export function cleanupAllFontDOM(): void {
    cleanupFontFaces();
    cleanupWebFonts();
    cleanupDyslexiaFonts();
    cleanupCachedFontStyles();
}
