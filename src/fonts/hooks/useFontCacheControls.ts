import { useState, useCallback, useEffect, useMemo, useRef } from "react";

import { isRemoteFont, downloadAndCacheRemoteFont } from "../fontPresets";
import { clearFontCache, setAutoCacheEnabled } from "../fontCache";
import { getWebFontsForLanguage, resetLoadedWebFontsMemory } from "../webFonts";
import { getDyslexiaFontsForLanguage, resetLoadedDyslexiaFontsMemory } from "../dyslexiaFonts";
import { useRealOnlineStatus } from "./useRealOnlineStatus";

interface UseFontCacheControlsParams {
    autoCacheFonts: boolean;
    translatedTextFontFamily: string;
    targetLanguage: string;
    webFonts: string[];
    dyslexiaFonts: string[];
    cachedFonts: Set<string>;
    refreshCachedFonts: () => void;
}

export interface FontCacheControlsState {
    cacheStatus: string;
    isCacheLoading: boolean;
    isDownloading: boolean;
    isAutoCaching: boolean;
    downloadedAll: boolean;
    downloadProgress: { done: number; total: number } | null;
    barWidth: number;
}

export interface FontCacheControlsDerived {
    isOnline: boolean;
    allRemoteFonts: string[];
    allFontsCached: boolean;
}

export interface FontCacheControlsActions {
    enqueueForAutoCache: (fontName: string) => void;
    handleClearCache: () => Promise<void>;
    handleDownloadAllFonts: () => Promise<void>;
}

export interface FontCacheControls {
    state: FontCacheControlsState;
    derived: FontCacheControlsDerived;
    actions: FontCacheControlsActions;
}

export function useFontCacheControls({
    autoCacheFonts,
    translatedTextFontFamily,
    targetLanguage,
    webFonts,
    dyslexiaFonts,
    cachedFonts,
    refreshCachedFonts,
}: UseFontCacheControlsParams): FontCacheControls {
    const [cacheStatus, setCacheStatus] = useState<string>('');
    const [isCacheLoading, setIsCacheLoading] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isAutoCaching, setIsAutoCaching] = useState(false);
    const [downloadedAll, setDownloadedAll] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);
    const [barWidth, setBarWidth] = useState(0);
    const fontProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const autoCacheQueueRef = useRef<string[]>([]);
    const isProcessingAutoCacheRef = useRef(false);
    const refreshCachedFontsRef = useRef(refreshCachedFonts);
    useEffect(() => { refreshCachedFontsRef.current = refreshCachedFonts; }, [refreshCachedFonts]);
    const cachedFontsRef = useRef(cachedFonts);
    useEffect(() => { cachedFontsRef.current = cachedFonts; }, [cachedFonts]);

    const startFontProgressAnimation = useCallback((done: number, total: number) => {
        const segmentSize = 100 / total;
        const segmentStart = done * segmentSize;
        const segmentTarget = segmentStart + segmentSize * 0.9;
        setBarWidth(segmentStart);
        if (fontProgressIntervalRef.current) clearInterval(fontProgressIntervalRef.current);
        fontProgressIntervalRef.current = setInterval(() => {
            setBarWidth(prev => {
                if (prev >= segmentTarget) {
                    clearInterval(fontProgressIntervalRef.current!);
                    fontProgressIntervalRef.current = null;
                    return segmentTarget;
                }
                const step = Math.max(0.05, (segmentTarget - prev) * 0.04);
                return Math.min(segmentTarget, prev + step);
            });
        }, 80);
    }, []);

    const completeFontProgressAnimation = useCallback((done: number, total: number): Promise<void> => {
        if (fontProgressIntervalRef.current) {
            clearInterval(fontProgressIntervalRef.current);
            fontProgressIntervalRef.current = null;
        }
        const segmentEnd = ((done + 1) / total) * 100;
        setBarWidth(segmentEnd);
        return new Promise(resolve => setTimeout(resolve, 120));
    }, []);

    const cacheStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearCacheStatusAfter = (ms: number) => {
        if (cacheStatusTimerRef.current) clearTimeout(cacheStatusTimerRef.current);
        cacheStatusTimerRef.current = setTimeout(() => setCacheStatus(''), ms);
    };

    const cancelCacheStatusTimer = () => {
        if (cacheStatusTimerRef.current) {
            clearTimeout(cacheStatusTimerRef.current);
            cacheStatusTimerRef.current = null;
        }
    };

    const processAutoCacheQueue = useCallback(async () => {
        if (isProcessingAutoCacheRef.current) return;
        const batch = autoCacheQueueRef.current.splice(0, autoCacheQueueRef.current.length);
        if (batch.length === 0) return;

        isProcessingAutoCacheRef.current = true;
        setIsAutoCaching(true);
        const total = batch.length;
        let processed = 0;
        try {
            for (const fontName of batch) {
                if (cachedFontsRef.current.has(fontName)) {
                    processed++;
                    continue;
                }
                setDownloadProgress({ done: processed, total });
                setBarWidth(processed === 0 ? 0 : (processed / total) * 100);
                startFontProgressAnimation(processed, total);
                const ok = await downloadAndCacheRemoteFont(fontName);
                await completeFontProgressAnimation(processed, total);
                if (ok) {
                    refreshCachedFontsRef.current();
                }
                processed++;
            }
        } finally {
            setIsAutoCaching(false);
            setDownloadProgress(null);
            setBarWidth(0);
            if (fontProgressIntervalRef.current) {
                clearInterval(fontProgressIntervalRef.current);
                fontProgressIntervalRef.current = null;
            }
            isProcessingAutoCacheRef.current = false;
            refreshCachedFontsRef.current();
            setTimeout(() => refreshCachedFontsRef.current(), 500);
            if (autoCacheQueueRef.current.length > 0) {
                processAutoCacheQueue();
            }
        }
    }, []);

    const enqueueForAutoCache = useCallback((fontName: string) => {
        if (cachedFontsRef.current.has(fontName)) return;
        if (!autoCacheQueueRef.current.includes(fontName)) {
            autoCacheQueueRef.current.push(fontName);
        }
        processAutoCacheQueue();
    }, [processAutoCacheQueue]);

    const isOnline = useRealOnlineStatus();

    const allRemoteFonts = useMemo(() => [...new Set([...webFonts, ...dyslexiaFonts])], [webFonts, dyslexiaFonts]);
    const allFontsCached = useMemo(() => allRemoteFonts.length > 0 && allRemoteFonts.every(f => cachedFonts.has(f)), [allRemoteFonts, cachedFonts]);

    const autoCacheFontsRef = useRef(autoCacheFonts);
    useEffect(() => {
        const wasEnabled = autoCacheFontsRef.current;
        autoCacheFontsRef.current = autoCacheFonts;
        setAutoCacheEnabled(autoCacheFonts);

        const fontFamily = translatedTextFontFamily;
        if (!wasEnabled && autoCacheFonts && fontFamily && isRemoteFont(fontFamily) && !cachedFontsRef.current.has(fontFamily)) {
            enqueueForAutoCache(fontFamily);
        }
    }, [autoCacheFonts, translatedTextFontFamily, enqueueForAutoCache]);

    useEffect(() => {
        setDownloadedAll(false);
    }, [targetLanguage]);

    const handleClearCache = useCallback(async () => {
        cancelCacheStatusTimer();
        setIsCacheLoading(true);
        setCacheStatus('Clearing...');
        try {
            setDownloadedAll(false);
            const currentFont = translatedTextFontFamily;
            const keepCurrent = currentFont && isRemoteFont(currentFont) && cachedFonts.has(currentFont);
            await clearFontCache(keepCurrent ? [currentFont] : undefined);
            resetLoadedWebFontsMemory();
            resetLoadedDyslexiaFontsMemory();
            setCacheStatus(keepCurrent ? `Cache cleared (kept ${currentFont})` : 'Cache cleared');
            refreshCachedFonts();
            setTimeout(() => refreshCachedFonts(), 500);
        } catch {
            setCacheStatus('Error clearing');
        } finally {
            setIsCacheLoading(false);
            clearCacheStatusAfter(3000);
        }
    }, [refreshCachedFonts, translatedTextFontFamily, cachedFonts]);

    const handleDownloadAllFonts = useCallback(async () => {
        const webFontsForLang = getWebFontsForLanguage(targetLanguage);
        const dyslexiaFontsForLang = getDyslexiaFontsForLanguage(targetLanguage);
        const allFonts = [...new Set([...webFontsForLang, ...dyslexiaFontsForLang])];

        const fontsToDownload = allFonts.filter(f => !cachedFonts.has(f));

        if (fontsToDownload.length === 0) {
            setCacheStatus('All fonts already cached');
            clearCacheStatusAfter(3000);
            return;
        }

        if (!isOnline) {
            setCacheStatus('No internet connection');
            clearCacheStatusAfter(3000);
            return;
        }

        cancelCacheStatusTimer();
        setIsDownloading(true);
        setBarWidth(0);
        setDownloadProgress({ done: 0, total: fontsToDownload.length });
        let processed = 0;
        let succeeded = 0;
        let failed = 0;
        try {
            for (const fontName of fontsToDownload) {
                setDownloadProgress({ done: processed, total: fontsToDownload.length });
                startFontProgressAnimation(processed, fontsToDownload.length);
                const ok = await downloadAndCacheRemoteFont(fontName);
                await completeFontProgressAnimation(processed, fontsToDownload.length);
                if (ok) {
                    succeeded++;
                } else {
                    failed++;
                }
                processed++;
                setDownloadProgress({ done: processed, total: fontsToDownload.length });
            }
            setDownloadProgress(null);
            setCacheStatus(
                failed === 0
                    ? `${succeeded} fonts cached`
                    : `${succeeded} cached, ${failed} failed`
            );
            if (failed === 0) setDownloadedAll(true);
            refreshCachedFonts();
        } catch {
            setDownloadProgress(null);
            setCacheStatus(`Cached ${succeeded}/${fontsToDownload.length}`);
            refreshCachedFonts();
        } finally {
            setIsDownloading(false);
            setDownloadProgress(null);
            setBarWidth(0);
            if (fontProgressIntervalRef.current) {
                clearInterval(fontProgressIntervalRef.current);
                fontProgressIntervalRef.current = null;
            }
            clearCacheStatusAfter(4000);
        }
    }, [targetLanguage, cachedFonts, isOnline, refreshCachedFonts]);

    return {
        state: {
            cacheStatus,
            isCacheLoading,
            isDownloading,
            isAutoCaching,
            downloadedAll,
            downloadProgress,
            barWidth,
        },
        derived: {
            isOnline,
            allRemoteFonts,
            allFontsCached,
        },
        actions: {
            enqueueForAutoCache,
            handleClearCache,
            handleDownloadAllFonts,
        },
    };
}
