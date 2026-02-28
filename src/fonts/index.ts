// fonts/index.ts - Barrel export for font modules

export { isDyslexiaFont, getDyslexiaFontsForLanguage, loadDyslexiaFont, preloadDyslexiaFonts } from "./dyslexiaFonts";
export { WEB_FONTS, LANGUAGE_WEB_FONTS, getWebFontsForLanguage, isWebFont, loadGoogleFont, preloadWebFontList } from "./webFonts";
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
    useFontOptions,
    isRemoteFont,
    loadRemoteFont,
} from "./fontPresets";
export type { FontStyleOption } from "./fontPresets";
