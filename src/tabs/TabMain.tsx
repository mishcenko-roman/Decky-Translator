// src/tabs/TabMain.tsx - Main tab with enable toggle and translate button

import {
    ButtonItem,
    PanelSection,
    PanelSectionRow,
    ToggleField,
    Router,
    Navigation,
    DialogButton,
    Focusable
} from "@decky/ui";

import { VFC } from "react";
import { BsTranslate, BsXLg, BsEye } from "react-icons/bs";
import { SiKofi } from "react-icons/si";
import { HiQrCode } from "react-icons/hi2";
import showQrModal from "../showQrModal";
import { useSettings } from "../SettingsContext";
import { GameTranslatorLogic } from "../Translator";
import { logger } from "../Logger";

interface TabMainProps {
    logic: GameTranslatorLogic;
    overlayVisible: boolean;
    providerStatus: any;
}

export const TabMain: VFC<TabMainProps> = ({ logic, overlayVisible, providerStatus }) => {
    const { settings, updateSetting } = useSettings();

    const handleButtonClick = () => {
        if (overlayVisible) {
            logic.imageState.hideImage();
            Router.CloseSideMenus();
        } else {
            // Close menu first, then wait for UI to fully close before taking screenshot
            Router.CloseSideMenus();
            setTimeout(() => {
                logic.takeScreenshotAndTranslate().catch(err => logger.error('TabMain', 'Screenshot failed', err));
            }, 200);
        }
    };

    return (
        <div style={{ marginLeft: "-8px", marginRight: "-8px" }}>
            <PanelSection>
                <PanelSectionRow>
                    <ToggleField
                        label={settings.enabled ? "Plugin is enabled" : "Plugin is disabled"}
                        description="Toggle the functionality on or off"
                        checked={settings.enabled}
                        onChange={(value) => updateSetting('enabled', value, 'Decky Translator')}
                    />
                </PanelSectionRow>

                {settings.enabled && (
                    <>
                        <PanelSectionRow>
                            <ButtonItem
                                bottomSeparator="standard"
                                layout="below"
                                onClick={handleButtonClick}>
                                {overlayVisible ?
                                    <span><BsXLg style={{marginRight: "8px"}} /> Close Overlay</span> :
                                    <span><BsTranslate style={{marginRight: "8px"}} /> Translate</span>
                                }
                            </ButtonItem>
                        </PanelSectionRow>

                        {/* Provider Status */}
                        <PanelSectionRow>
                            <div style={{ fontSize: '12px', marginTop: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                                    <BsEye style={{ marginRight: '8px', color: '#aaa' }} />
                                    <span style={{ color: '#888' }}>Text Recognition:</span>
                                    <span style={{ marginLeft: '6px', fontWeight: 'bold' }}>
                                        {settings.ocrProvider === 'chromescreenai' ? 'On-Device' :
                                         settings.ocrProvider === 'rapidocr' ? 'On-Device' :
                                         settings.ocrProvider === 'ocrspace' ? 'OCR.space' :
                                         settings.ocrProvider === 'gemini_vision' ? 'Gemini Vision' : 'Google Cloud'}
                                    </span>
                                </div>
                                {settings.ocrProvider === 'rapidocr' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        {providerStatus?.rapidocr_available ? (
                                            <>
                                                <div style={{ color: '#666', fontSize: '10px' }}>On-device Text Recognition</div>
                                                <div style={{ color: '#666', fontSize: '10px' }}>Version:{providerStatus?.rapidocr_info?.version ? ` (v${providerStatus.rapidocr_info.version})` : ''}</div>
                                            </>
                                        ) : (
                                            <div style={{ color: '#ff6b6b', fontSize: '10px' }}>
                                                {providerStatus?.rapidocr_error || 'Not available - RapidOCR not initialized'}
                                            </div>
                                        )}
                                        <div style={{ color: '#666', fontSize: '10px' }}>No internet needed</div>
                                    </div>
                                )}
                                {settings.ocrProvider === 'chromescreenai' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        <div style={{ color: providerStatus?.chromescreenai_downloaded ? '#666' : '#ff6b6b', fontSize: '10px' }}>
                                            {providerStatus?.chromescreenai_downloaded ? 'Chrome Screen AI engine ready' : 'Engine not downloaded'}
                                        </div>
                                        <div style={{ color: '#666', fontSize: '10px' }}>No internet needed</div>
                                    </div>
                                )}
                                {settings.ocrProvider === 'gemini_vision' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        <div style={{ color: settings.geminiApiKey ? '#666' : '#ff6b6b', fontSize: '10px' }}>
                                            {settings.geminiApiKey ? 'API key configured' : 'API key required'}
                                        </div>
                                        <div style={{ color: '#666', fontSize: '10px' }}>
                                            Model: {settings.geminiModel.replace(/^gemini-/, '').split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                        </div>
                                        <div style={{ color: '#666', fontSize: '10px' }}>Requires internet connection</div>
                                    </div>
                                )}
                                {settings.ocrProvider === 'googlecloud' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        <div style={{ color: settings.googleApiKey ? '#666' : '#ff6b6b', fontSize: '10px' }}>
                                            {settings.googleApiKey ? 'API key configured' : 'API key required'}
                                        </div>
                                        <div style={{ color: '#666', fontSize: '10px' }}>Requires internet connection</div>
                                    </div>
                                )}
                                {settings.ocrProvider === 'ocrspace' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        <div style={{ color: '#666', fontSize: '10px', marginBottom: '4px' }}>Free, no API key needed</div>
                                        {providerStatus?.ocr_usage && (
                                            <>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: '3px'
                                                }}>
                                                    <span style={{ color: '#666', fontSize: '10px' }}>
                                                        10 min limit:
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px',
                                                        color: providerStatus.ocr_usage.rate_remaining <= 2 ? '#ff6b6b' : '#888'
                                                    }}>
                                                        {providerStatus.ocr_usage.rate_remaining}/{providerStatus.ocr_usage.rate_limit}
                                                    </span>
                                                </div>
                                                <div style={{
                                                    height: '3px',
                                                    backgroundColor: 'rgba(255,255,255,0.1)',
                                                    borderRadius: '2px',
                                                    overflow: 'hidden',
                                                    marginBottom: '4px'
                                                }}>
                                                    <div style={{
                                                        height: '100%',
                                                        width: `${(providerStatus.ocr_usage.rate_remaining / providerStatus.ocr_usage.rate_limit) * 100}%`,
                                                        backgroundColor: providerStatus.ocr_usage.rate_remaining <= 2
                                                            ? '#ff6b6b'
                                                            : providerStatus.ocr_usage.rate_remaining <= 5
                                                                ? '#ffa726'
                                                                : '#4caf50',
                                                        borderRadius: '2px',
                                                        transition: 'width 0.3s ease'
                                                    }} />
                                                </div>
                                                {providerStatus.ocr_usage.rate_remaining === 0 && providerStatus.ocr_usage.rate_reset_seconds > 0 && (
                                                    <div style={{ color: '#ff6b6b', fontSize: '10px', marginBottom: '4px' }}>
                                                        Rate limit exceeded - resets in {Math.ceil(providerStatus.ocr_usage.rate_reset_seconds / 60)} min
                                                    </div>
                                                )}

                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: '3px'
                                                }}>
                                                    <span style={{ color: '#666', fontSize: '10px' }}>
                                                        Daily limit:
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px',
                                                        color: providerStatus.ocr_usage.remaining < 50 ? '#ff6b6b' : '#888'
                                                    }}>
                                                        {providerStatus.ocr_usage.remaining}/{providerStatus.ocr_usage.limit}
                                                    </span>
                                                </div>
                                                <div style={{
                                                    height: '3px',
                                                    backgroundColor: 'rgba(255,255,255,0.1)',
                                                    borderRadius: '2px',
                                                    overflow: 'hidden',
                                                    marginBottom: '4px'
                                                }}>
                                                    <div style={{
                                                        height: '100%',
                                                        width: `${(providerStatus.ocr_usage.remaining / providerStatus.ocr_usage.limit) * 100}%`,
                                                        backgroundColor: providerStatus.ocr_usage.remaining < 50
                                                            ? '#ff6b6b'
                                                            : providerStatus.ocr_usage.remaining < 100
                                                                ? '#ffa726'
                                                                : '#4caf50',
                                                        borderRadius: '2px',
                                                        transition: 'width 0.3s ease'
                                                    }} />
                                                </div>
                                                {providerStatus.ocr_usage.remaining < 50 && (
                                                    <div style={{ color: '#ff6b6b', fontSize: '10px', marginBottom: '4px' }}>
                                                        Low daily requests remaining
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        <div style={{ color: '#666', fontSize: '10px' }}>Requires internet connection</div>
                                    </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                                    <BsTranslate style={{ marginRight: '8px', color: '#aaa' }} />
                                    <span style={{ color: '#888' }}>Translation:</span>
                                    <span style={{ marginLeft: '6px', fontWeight: 'bold' }}>
                                        {settings.ocrProvider === 'gemini_vision' ? 'Gemini Vision' :
                                         settings.translationProvider === 'googlecloud' ? 'Google Cloud' :
                                         settings.translationProvider === 'ct2' ? 'On-Device' : 'Google Translate'}
                                    </span>
                                </div>
                                <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                    {settings.ocrProvider === 'gemini_vision' && (
                                        <>
                                            <div style={{ color: settings.geminiApiKey ? '#666' : '#ff6b6b', fontSize: '10px' }}>
                                                {settings.geminiApiKey ? 'API key configured' : 'API key required'}
                                            </div>
                                            <div style={{ color: '#666', fontSize: '10px' }}>
                                                Model: {settings.geminiModel.replace(/^gemini-/, '').split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                            </div>
                                            <div style={{ color: '#666', fontSize: '10px' }}>Requires internet connection</div>
                                        </>
                                    )}
                                    {settings.ocrProvider !== 'gemini_vision' && settings.translationProvider === 'freegoogle' && (
                                        <>
                                            <div style={{ color: '#666', fontSize: '10px' }}>No API key needed</div>
                                            <div style={{ color: '#666', fontSize: '10px' }}>Requires internet connection</div>
                                        </>
                                    )}
                                    {settings.ocrProvider !== 'gemini_vision' && settings.translationProvider === 'googlecloud' && (
                                        <>
                                            <div style={{ color: settings.googleApiKey ? '#666' : '#ff6b6b', fontSize: '10px' }}>
                                                {settings.googleApiKey ? 'API key configured' : 'API key required'}
                                            </div>
                                            <div style={{ color: '#666', fontSize: '10px' }}>Requires internet connection</div>
                                        </>
                                    )}
                                    {settings.ocrProvider !== 'gemini_vision' && settings.translationProvider === 'ct2' && (
                                        <>
                                            <div style={{ color: providerStatus?.nllb_downloaded ? '#666' : '#ff6b6b', fontSize: '10px' }}>
                                                {providerStatus?.nllb_downloaded ? 'Installed model: NLLB-200 1.3B' : 'Installed model: None'}
                                            </div>
                                            <div style={{ color: '#666', fontSize: '10px' }}>No internet needed</div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </PanelSectionRow>
                    </>
                )}

                {/* Ko-fi Support Button */}
                <PanelSectionRow>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'center',
                            marginTop: '12px',
                        }}
                    >
                        <Focusable>
                            <DialogButton
                                onClick={() => {
                                    Navigation.CloseSideMenus();
                                    Navigation.NavigateToExternalWeb('https://ko-fi.com/alexanderdev');
                                }}
                                onSecondaryButton={() => showQrModal('https://ko-fi.com/alexanderdev')}
                                onSecondaryActionDescription="Show QR Code"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '6px 12px',
                                    fontSize: '11px',
                                    minWidth: 'auto',
                                }}
                            >
                                <SiKofi style={{ fontSize: '13px' }} />
                                <span>Support on Ko-fi</span>
                                <HiQrCode style={{ fontSize: '13px', opacity: 0.6 }} />
                            </DialogButton>
                        </Focusable>
                    </div>
                </PanelSectionRow>
            </PanelSection>
        </div>
    );
};
