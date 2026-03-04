import { VFC } from "react";
import { DialogButton } from "@decky/ui";
import { FONT_CACHE_INDICATOR_COLOR, type FontCacheControls } from "../fonts";

interface AutoCacheDescriptionProps {
    cacheControls: FontCacheControls;
}

export const AutoCacheDescription: VFC<AutoCacheDescriptionProps> = ({ cacheControls }) => {
    const { state: cacheState, derived: cacheDerived, actions: cacheActions } = cacheControls;

    const isCacheBusy = cacheState.isDownloading || cacheState.isAutoCaching;
    const isClearCacheDisabled = cacheState.isCacheLoading || cacheState.isDownloading;
    const downloadButtonLabel = cacheState.isDownloading ? 'Downloading...' : 'Download All';
    const clearButtonLabel = cacheState.isCacheLoading ? 'Clearing...' : 'Clear Cache';
    const isDownloadAllDisabled =
        cacheState.isDownloading ||
        cacheState.isAutoCaching ||
        !cacheDerived.isOnline ||
        cacheDerived.allFontsCached ||
        cacheState.downloadedAll;

    const renderAutoCacheStatus = () => {
        if (isCacheBusy && cacheState.downloadProgress) {
            return (
                <div style={{ height: '4px', borderRadius: '2px', backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                    <div style={{
                        height: '100%',
                        borderRadius: '2px',
                        backgroundColor: FONT_CACHE_INDICATOR_COLOR,
                        width: `${cacheState.barWidth}%`,
                        transition: 'width 0.08s linear',
                    }} />
                </div>
            );
        }

        if (cacheState.cacheStatus) {
            return cacheState.cacheStatus;
        }

        if (!cacheDerived.isOnline) {
            return 'No internet — only cached fonts available';
        }

        if (cacheDerived.allFontsCached) {
            return `All ${cacheDerived.allRemoteFonts.length} fonts cached for offline use`;
        }

        return null;
    };

    return (
        <div>
            <div style={{ marginBottom: '8px' }}>
                <span>Automatically download selected fonts for offline use. Cached fonts are marked as - <span style={{ color: FONT_CACHE_INDICATOR_COLOR }}>●</span></span>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <DialogButton
                    style={{ minWidth: 0, flex: 1, padding: '8px 12px', fontSize: '16px' }}
                    disabled={isDownloadAllDisabled}
                    onClick={cacheActions.handleDownloadAllFonts}
                >
                    {downloadButtonLabel}
                </DialogButton>
                <DialogButton
                    style={{ minWidth: 0, flex: 1, padding: '8px 12px', fontSize: '16px' }}
                    disabled={isClearCacheDisabled}
                    onClick={cacheActions.handleClearCache}
                >
                    {clearButtonLabel}
                </DialogButton>
            </div>
            <div>{renderAutoCacheStatus()}</div>
        </div>
    );
};
