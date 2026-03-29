import { useCallback } from "react";

import { isRemoteFont, loadRemoteFont } from "../fontPresets";

interface UseTranslatedTextFontChangeParams {
    autoCacheFonts: boolean;
    cachedFonts: Set<string>;
    enqueueForAutoCache: (fontName: string) => void;
    updateSetting: (key: 'translatedTextFontFamily', value: string, label?: string) => Promise<boolean>;
}

export function useTranslatedTextFontChange({
    autoCacheFonts,
    cachedFonts,
    enqueueForAutoCache,
    updateSetting,
}: UseTranslatedTextFontChangeParams) {
    return useCallback(async (option: { data: string }) => {
        const fontName = option.data;

        if (fontName && isRemoteFont(fontName)) {
            // Load the font first — only persist the setting once the font is
            // confirmed available. This avoids a state where the setting is
            // saved to the backend but the font never actually loaded (e.g.
            // the app closed between the two calls in the old optimistic path).
            const loaded = await loadRemoteFont(fontName, { allowAutoCache: false });
            if (!loaded) {
                return;
            }

            await updateSetting('translatedTextFontFamily', fontName, 'Text font');

            if (autoCacheFonts && !cachedFonts.has(fontName)) {
                enqueueForAutoCache(fontName);
            }
            return;
        }

        await updateSetting('translatedTextFontFamily', fontName, 'Text font');
    }, [
        autoCacheFonts,
        cachedFonts,
        enqueueForAutoCache,
        updateSetting,
    ]);
}
