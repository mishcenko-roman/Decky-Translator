// src/tabs/TabTranslation.tsx - Language and provider settings

import {
    PanelSection,
    PanelSectionRow,
    Dropdown,
    DropdownItem,
    SliderField,
    ToggleField,
    showModal,
    ModalRoot,
    DialogButton,
    TextField,
    Field,
    Focusable
} from "@decky/ui";

import { VFC, useState, useEffect, useRef, useCallback, RefObject } from "react";
import { call } from "@decky/api";
import { useSettings } from "../SettingsContext";
import { HiKey, HiLockClosed, HiInboxArrowDown, HiTrash, HiXMark } from "react-icons/hi2";
import { BsArrowRepeat, BsStars } from "react-icons/bs";

// @ts-ignore
import ocrspaceLogo from "../../assets/ocrspace-logo.png";
// @ts-ignore
import googlecloudLogo from "../../assets/googlecloud-logo.png";
// @ts-ignore
import googletranslateLogo from "../../assets/googletranslate-logo.png";
// @ts-ignore
import geminiLogo from "../../assets/gemini-logo.png";
// @ts-ignore
import steamdeckLogo from "../../assets/steamdeck-logo.png";
// @ts-ignore
import chromeLogo from "../../assets/chrome-logo.png";

// Language options with flag emojis
const languageOptions = [
    { label: "\ud83c\udf10 Auto-detect", data: "auto" },
    { label: "\ud83c\uddf8\ud83c\udde6 Arabic", data: "ar" },
    { label: "\ud83c\udde7\ud83c\uddec Bulgarian", data: "bg" },
    { label: "\ud83c\udde8\ud83c\uddf3 Chinese (Simplified)", data: "zh-CN" },
    { label: "\ud83c\uddf9\ud83c\uddfc Chinese (Traditional)", data: "zh-TW" },
    { label: "\ud83c\udded\ud83c\uddf7 Croatian", data: "hr" },
    { label: "\ud83c\udde8\ud83c\uddff Czech", data: "cs" },
    { label: "\ud83c\udde9\ud83c\uddf0 Danish", data: "da" },
    { label: "\ud83c\uddf3\ud83c\uddf1 Dutch", data: "nl" },
    { label: "\ud83c\uddec\ud83c\udde7 English", data: "en" },
    { label: "\ud83c\uddeb\ud83c\uddee Finnish", data: "fi" },
    { label: "\ud83c\uddeb\ud83c\uddf7 French", data: "fr" },
    { label: "\ud83c\udde9\ud83c\uddea German", data: "de" },
    { label: "\ud83c\uddec\ud83c\uddf7 Greek", data: "el" },
    { label: "\ud83c\uddee\ud83c\uddf3 Hindi", data: "hi" },
    { label: "\ud83c\udded\ud83c\uddfa Hungarian", data: "hu" },
    { label: "\ud83c\uddee\ud83c\uddf9 Italian", data: "it" },
    { label: "\ud83c\uddef\ud83c\uddf5 Japanese", data: "ja" },
    { label: "\ud83c\uddf0\ud83c\uddf7 Korean", data: "ko" },
    { label: "\ud83c\uddf5\ud83c\uddf1 Polish", data: "pl" },
    { label: "\ud83c\uddf5\ud83c\uddf9 Portuguese", data: "pt" },
    { label: "\ud83c\uddf7\ud83c\uddf4 Romanian", data: "ro" },
    { label: "\ud83c\uddf7\ud83c\uddfa Russian", data: "ru" },
    { label: "\ud83c\uddea\ud83c\uddf8 Spanish", data: "es" },
    { label: "\ud83c\uddf8\ud83c\uddea Swedish", data: "sv" },
    { label: "\ud83c\uddf9\ud83c\udded Thai", data: "th" },
    { label: "\ud83c\uddf9\ud83c\uddf7 Turkish", data: "tr" },
    { label: "\ud83c\uddfa\ud83c\udde6 Ukrainian", data: "uk" },
    { label: "\ud83c\uddfb\ud83c\uddf3 Vietnamese", data: "vi" }
];

const selectLanguageOption = { label: "Select language...", data: "" };
const outputLanguageOptions = languageOptions.filter(lang => lang.data !== "auto");

// Languages RapidOCR able to work with
const rapidocrLanguages = new Set([
    'en', 'zh-CN', 'zh-TW', 'ja', 'ko',
    'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'tr', 'ro', 'vi', 'fi', 'hr',
    'cs', 'hu', 'sv', 'da',
    'ru', 'uk', 'el', 'th', 'bg'
]);

function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / (1024 * 1024)) + ' MB';
}

// API Key Modal Component
const ApiKeyModal: VFC<{
    currentKey: string;
    onSave: (key: string) => void;
    closeModal?: () => void;
    title?: string;
    description?: string;
}> = ({ currentKey, onSave, closeModal, title, description }) => {
    const [apiKey, setApiKey] = useState(currentKey || "");

    return (
        <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
            <div style={{ padding: "20px", minWidth: "400px" }}>
                <h2 style={{ marginBottom: "15px" }}>{title || "API Key"}</h2>
                <p style={{ marginBottom: "15px", color: "#aaa", fontSize: "13px" }}>
                    {description || "Enter your API key."}
                </p>
                <TextField
                    label="API Key"
                    value={apiKey}
                    bIsPassword={true}
                    bShowClearAction={true}
                    onChange={(e) => setApiKey(e.target.value)}
                />
                <Focusable
                    style={{ display: "flex", gap: "10px", marginTop: "20px", justifyContent: "flex-end" }}
                >
                    <DialogButton onClick={closeModal}>
                        Cancel
                    </DialogButton>
                    <DialogButton
                        onClick={() => {
                            onSave(apiKey);
                            closeModal?.();
                        }}
                    >
                        Save
                    </DialogButton>
                </Focusable>
            </div>
        </ModalRoot>
    );
};

const knownGeminiModels: DropdownItem[] = [
    { label: <span>2.5 Flash</span>, data: "gemini-2.5-flash" },
    { label: <span>2.5 Flash Lite</span>, data: "gemini-2.5-flash-lite" },
    { label: <span>3 Flash (Preview)</span>, data: "gemini-3-flash-preview" },
    { label: <span>3 Flash</span>, data: "gemini-3-flash" },
    { label: <span>3.1 Flash Lite (Preview)</span>, data: "gemini-3.1-flash-lite-preview" },
    { label: <span>3.1 Flash Lite</span>, data: "gemini-3.1-flash-lite" },
];

const GeminiModelSelector: VFC<{
    selectedModel: string;
    hasApiKey: boolean;
    onChange: (model: string) => void;
}> = ({ selectedModel, hasApiKey, onChange }) => {
    const [models, setModels] = useState<DropdownItem[]>(knownGeminiModels);
    const [loading, setLoading] = useState(false);
    const [validated, setValidated] = useState(false);

    const validateModels = async () => {
        if (!hasApiKey) return;
        setLoading(true);
        try {
            const available = await call<[], string[]>('get_gemini_models');
            if (available && available.length > 0) {
                const availableSet = new Set(available);
                const filtered = knownGeminiModels.filter(m => availableSet.has(m.data));
                if (filtered.length > 0) {
                    setModels(filtered);
                    // If current selection was removed, switch to first available
                    if (!availableSet.has(selectedModel) && filtered.length > 0) {
                        onChange(filtered[0].data);
                    }
                }
            }
            setValidated(true);
        } catch (e) {
            // keep full list on error
        }
        setLoading(false);
    };

    // Validate when component mounts (user selected Gemini Vision)
    useEffect(() => {
        if (hasApiKey && !validated) {
            validateModels();
        }
    }, [hasApiKey]);

    return (
        <>
            <style>{`@keyframes gemini-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            <PanelSectionRow>
                <Field
                    label="Gemini Model"
                    childrenContainerWidth="max"
                    childrenLayout="below"
                    focusable={false}
                >
                    <Focusable style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                            <Dropdown
                                rgOptions={models}
                                selectedOption={selectedModel}
                                onChange={(option) => onChange(option.data)}
                            />
                        </div>
                        <DialogButton
                            onClick={validateModels}
                            disabled={loading || !hasApiKey}
                            style={{ minWidth: "40px", width: "40px", padding: "10px 0" }}
                        >
                            <BsArrowRepeat style={loading ? { animation: "gemini-spin 1s linear infinite" } : {}} />
                        </DialogButton>
                    </Focusable>
                </Field>
            </PanelSectionRow>
        </>
    );
};

// Mirrors CT2ModelManager but for the Chrome Screen AI engine.
const ChromeScreenAIManager: VFC<{ actionRef?: RefObject<HTMLDivElement> }> = ({ actionRef }) => {
    const [status, setStatus] = useState<any>({
        downloaded: false, size: 0, approx_size_mb: 120,
        downloading: false, progress: 0, error: null,
    });
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const refresh = useCallback(async () => {
        try {
            const s = await call<[], any>('get_chromescreenai_status');
            if (s) setStatus(s);
        } catch (e) { /* ignore */ }
    }, []);

    useEffect(() => { refresh(); }, []);

    useEffect(() => {
        if (status.downloading) {
            pollRef.current = setInterval(refresh, 500);
        } else if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [status.downloading, refresh]);

    const handleDownload = async () => {
        await call('clear_chromescreenai_error');
        const started = await call<[], boolean>('download_chromescreenai');
        if (started) {
            setStatus((prev: any) => ({ ...prev, downloading: true, progress: 0, error: null }));
        }
    };
    const handleCancel = async () => { await call('cancel_chromescreenai_download'); };
    const handleDelete = async () => { await call('delete_chromescreenai'); refresh(); };

    const isDownloading = status.downloading;
    const isDownloaded = status.downloaded;
    const progressPct = Math.round((status.progress || 0) * 100);
    const statusColor = isDownloading ? "#ffa726" : isDownloaded ? "#4caf50" : "#ff6b6b";
    const installedSize = status.size ? ` (${formatBytes(status.size)})` : '';
    const approxSize = status.approx_size_mb ? ` (${Math.round(status.approx_size_mb)} MB)` : '';
    const statusText = isDownloading
        ? `downloading ${progressPct}%`
        : isDownloaded
            ? `ready${installedSize}`
            : `not installed${approxSize}`;
    const ActionIcon = isDownloading ? HiXMark : isDownloaded ? HiTrash : HiInboxArrowDown;
    const onActionClick = isDownloading ? handleCancel : isDownloaded ? handleDelete : handleDownload;

    return (
        <>
            <PanelSectionRow>
                <Focusable style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "8px 0px",
                    width: "100%",
                }}>
                    <div style={{ flex: 1, minWidth: 0, paddingLeft: '3px' }}>
                        <div>Chrome Screen AI</div>
                        <div style={{
                            fontSize: "11px",
                            color: "#888",
                            fontWeight: "normal",
                            marginTop: "2px",
                            whiteSpace: "nowrap",
                        }}>
                            offline OCR engine
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                            <div style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                backgroundColor: statusColor,
                                flexShrink: 0,
                            }} />
                            <span style={{ fontSize: "11px", color: statusColor, fontWeight: "normal" }}>
                                {statusText}
                            </span>
                        </div>
                        {isDownloading && (
                            <div style={{
                                marginTop: "4px",
                                height: "3px",
                                backgroundColor: "rgba(255,255,255,0.1)",
                                borderRadius: "2px",
                                overflow: "hidden",
                            }}>
                                <div style={{
                                    width: `${progressPct}%`,
                                    height: "100%",
                                    backgroundColor: statusColor,
                                    borderRadius: "2px",
                                    transition: "width 0.3s ease",
                                }} />
                            </div>
                        )}
                    </div>
                    <DialogButton
                        ref={actionRef}
                        onClick={onActionClick}
                        style={{ minWidth: "40px", width: "40px", padding: "10px 0", flexShrink: 0 }}
                    >
                        <ActionIcon size={20} />
                    </DialogButton>
                </Focusable>
            </PanelSectionRow>

            {status.error && (
                <PanelSectionRow>
                    <Field focusable={true} childrenContainerWidth="max">
                        <div style={{ color: "#ff6b6b", fontSize: "11px" }}>
                            {status.error}
                        </div>
                    </Field>
                </PanelSectionRow>
            )}
            <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.08)" }} />
        </>
    );
};

// NLLB Model Management Component
const CT2ModelManager: VFC<{ actionRef?: RefObject<HTMLDivElement> }> = ({ actionRef }) => {
    const { settings } = useSettings();
    const [modelStatus, setModelStatus] = useState<any>({
        downloaded: false, size: 0, approx_size_mb: 1410,
        downloading: false, progress: 0, error: null,
    });
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const refreshStatus = useCallback(async () => {
        try {
            const status = await call<[], any>('get_nllb_model_status');
            if (status) setModelStatus(status);
        } catch (e) { /* ignore */ }
    }, []);

    useEffect(() => { refreshStatus(); }, []);

    // Poll while downloading
    useEffect(() => {
        if (modelStatus.downloading) {
            pollRef.current = setInterval(refreshStatus, 500);
        } else {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [modelStatus.downloading, refreshStatus]);

    const handleDownload = async () => {
        await call('clear_nllb_model_error');
        const started = await call<[], boolean>('download_nllb_model');
        if (started) {
            setModelStatus((prev: any) => ({ ...prev, downloading: true, progress: 0, error: null }));
        }
    };

    const handleCancel = async () => {
        await call('cancel_nllb_download');
    };

    const handleDelete = async () => {
        await call('delete_nllb_model');
        refreshStatus();
    };

    const isAutoDetect = settings.inputLanguage === 'auto' || settings.inputLanguage === '';
    const isDownloading = modelStatus.downloading;
    const isDownloaded = modelStatus.downloaded;

    const progressPct = Math.round((modelStatus.progress || 0) * 100);
    const statusColor = isDownloading ? "#ffa726" : isDownloaded ? "#4caf50" : "#ff6b6b";
    const installedSize = modelStatus.size ? ` (${formatBytes(modelStatus.size)})` : '';
    const approxSize = modelStatus.approx_size_mb ? ` (${Math.round(modelStatus.approx_size_mb)} MB)` : '';
    const statusText = isDownloading
        ? `downloading ${progressPct}%`
        : isDownloaded
            ? `ready${installedSize}`
            : `not installed${approxSize}`;
    const ActionIcon = isDownloading ? HiXMark : isDownloaded ? HiTrash : HiInboxArrowDown;
    const onActionClick = isDownloading ? handleCancel : isDownloaded ? handleDelete : handleDownload;

    return (
        <>
            <PanelSectionRow>
                <Focusable style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "8px 0px",
                    width: "100%",
                }}>
                    <div style={{ flex: 1, minWidth: 0, paddingLeft: '3px' }}>
                        <div>NLLB-200 1.3B</div>
                        <div style={{
                            fontSize: "11px",
                            color: "#888",
                            fontWeight: "normal",
                            marginTop: "2px",
                            whiteSpace: "nowrap",
                        }}>
                            offline language model
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                            <div style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                backgroundColor: statusColor,
                                flexShrink: 0,
                            }} />
                            <span style={{ fontSize: "11px", color: statusColor, fontWeight: "normal" }}>
                                {statusText}
                            </span>
                        </div>
                        {isDownloading && (
                            <div style={{
                                marginTop: "4px",
                                height: "3px",
                                backgroundColor: "rgba(255,255,255,0.1)",
                                borderRadius: "2px",
                                overflow: "hidden",
                            }}>
                                <div style={{
                                    width: `${progressPct}%`,
                                    height: "100%",
                                    backgroundColor: statusColor,
                                    borderRadius: "2px",
                                    transition: "width 0.3s ease",
                                }} />
                            </div>
                        )}
                    </div>
                    <DialogButton
                        ref={actionRef}
                        onClick={onActionClick}
                        style={{ minWidth: "40px", width: "40px", padding: "10px 0", flexShrink: 0 }}
                    >
                        <ActionIcon size={20} />
                    </DialogButton>
                </Focusable>
            </PanelSectionRow>

            {modelStatus.error && (
                <PanelSectionRow>
                    <Field focusable={true} childrenContainerWidth="max">
                        <div style={{ color: "#ff6b6b", fontSize: "11px" }}>
                            {modelStatus.error}
                        </div>
                    </Field>
                </PanelSectionRow>
            )}

            {isAutoDetect && (
                <PanelSectionRow>
                    <Field focusable={true} childrenContainerWidth="max">
                        <div style={{ color: "#ffa726", fontSize: "12px", lineHeight: "1.5" }}>
                            Offline translation needs a specific source language. Select one in the Languages section above.
                        </div>
                    </Field>
                </PanelSectionRow>
            )}
            <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.08)" }} />
        </>
    );
};

const StarRating: VFC<{ label: string; filled: number; total?: number }> = ({ label, filled, total = 3 }) => (
    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: "#888", fontSize: "11px" }}>{label}</span>
        {Array.from({ length: total }, (_, i) => (
            <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill={i < filled ? "#ffa726" : "#444"}>
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>
            </svg>
        ))}
    </span>
);

const ProviderRating: VFC<{ quality: number; speed: number }> = ({ quality, speed }) => (
    <div style={{ display: "flex", gap: "16px", marginBottom: "6px" }}>
        <StarRating label="Quality" filled={quality} />
        <StarRating label="Speed" filled={speed} />
    </div>
);

interface TabTranslationProps {
    scrollTarget?: string | null;
    onScrolled?: () => void;
}

export const TabTranslation: VFC<TabTranslationProps> = ({ scrollTarget, onScrolled }) => {
    const { settings, updateSetting } = useSettings();
    const chromescreenaiActionRef = useRef<HTMLDivElement>(null);
    const ct2ActionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!scrollTarget) return;
        const ref = scrollTarget === 'chromescreenai-action' ? chromescreenaiActionRef
                  : scrollTarget === 'ct2-action' ? ct2ActionRef
                  : null;

        // Wait for Steam's tab transition + focus router to settle before scrolling, otherwise our scroll gets overridden.
        const timeoutId = setTimeout(() => {
            const el = ref?.current as HTMLElement | null;
            if (el) {
                el.focus({ preventScroll: true });
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            onScrolled?.();
        }, 400);

        return () => clearTimeout(timeoutId);
    }, [scrollTarget]);

    const isCT2 = settings.translationProvider === 'ct2';
    const filteredLanguageOptions = isCT2
        ? languageOptions.filter(lang => lang.data !== "auto")
        : languageOptions;

    const placeholderOption = settings.inputLanguage === '' ? [selectLanguageOption] : [];
    const inputLanguageOptions = settings.ocrProvider === 'rapidocr'
        ? [...placeholderOption, ...filteredLanguageOptions.filter(lang => rapidocrLanguages.has(lang.data))]
        : [...placeholderOption, ...filteredLanguageOptions];

    // Reset input language if it's not supported by the current OCR provider
    useEffect(() => {
        if (settings.initialized && settings.ocrProvider === 'rapidocr'
            && settings.inputLanguage !== '' && !rapidocrLanguages.has(settings.inputLanguage)) {
            updateSetting('inputLanguage', '', 'Input language');
        }
    }, [settings.initialized, settings.ocrProvider]);

    // When switching to CT2, if source is auto-detect, clear it so user picks a specific language
    useEffect(() => {
        if (settings.initialized && isCT2 && settings.inputLanguage === 'auto') {
            updateSetting('inputLanguage', '', 'Input language');
        }
    }, [settings.initialized, settings.translationProvider]);

    return (
        <div style={{ paddingBottom: "40px" }}>
            <PanelSection title="Languages">
                <PanelSectionRow>
                    <DropdownItem
                        label="Input Language"
                        description={isCT2
                            ? "Source language (auto-detect not available for offline translation)"
                            : settings.ocrProvider === 'rapidocr'
                                ? "Source language for text recognition"
                                : "Source language (Select auto-detect if unsure)"}
                        rgOptions={inputLanguageOptions}
                        selectedOption={settings.inputLanguage}
                        onChange={(option: any) => updateSetting('inputLanguage', option.data, 'Input language')}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <DropdownItem
                        label="Output Language"
                        description="Target language for translation"
                        rgOptions={[...(settings.targetLanguage === '' ? [selectLanguageOption] : []), ...outputLanguageOptions]}
                        selectedOption={settings.targetLanguage}
                        onChange={(option: any) => updateSetting('targetLanguage', option.data, 'Output language')}
                    />
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title="Recognition">
                {/* OCR Provider Selection */}
                <PanelSectionRow>
                    <Field
                        label="Text Recognition Method"
                        childrenContainerWidth="max"
                        childrenLayout="below"
                        focusable={false}
                    >
                        <Focusable style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <div className="dt-ocr-dropdown-wrapper" style={{ flex: 1 }}>
                                <style>{`.dt-ocr-dropdown-wrapper .dt-recommended-tag { display: none !important; }`}</style>
                            <Dropdown
                                rgOptions={[
                                    { label: <span>On-Device <span style={{ fontSize: "10px", opacity: 0.7 }}>(RapidOCR)</span></span>, data: "rapidocr" },
                                    { label: <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%" }}><span>On-Device <span style={{ fontSize: "10px", opacity: 0.7 }}>(Google)</span></span><span className="dt-recommended-tag" style={{ fontSize: "10px", color: "#9aa0a6", fontStyle: "italic" }}>★ recommended</span></span>, data: "chromescreenai" },
                                    { label: <span>OCR.space</span>, data: "ocrspace" },
                                    { label: <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%" }}><span>Google Cloud</span><span className="dt-recommended-tag" style={{ fontSize: "10px", color: "#9aa0a6", fontStyle: "italic" }}>★ recommended</span></span>, data: "googlecloud" },
                                    { label: <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>Gemini Vision <BsStars style={{ fontSize: "12px" }} /></span>, data: "gemini_vision" }
                                ]}
                                selectedOption={settings.ocrProvider}
                                onChange={(option) => {
                                    updateSetting('ocrProvider', option.data, 'OCR provider');
                                    if (option.data === 'rapidocr' && settings.inputLanguage !== '' && !rapidocrLanguages.has(settings.inputLanguage)) {
                                        updateSetting('inputLanguage', '', 'Input language');
                                    }
                                }}
                            />
                            </div>
                            {settings.ocrProvider === 'googlecloud' && (
                                <DialogButton
                                    onClick={() => {
                                        showModal(
                                            <ApiKeyModal
                                                currentKey={settings.googleApiKey}
                                                onSave={(key) => updateSetting('googleApiKey', key, 'Google API Key')}
                                                title="Google Cloud API Key"
                                                description="Enter your Google Cloud API key for Vision and Translation services."
                                            />
                                        );
                                    }}
                                    style={{ minWidth: "40px", width: "40px", padding: "10px 0" }}
                                >
                                    <div style={{ position: "relative", display: "inline-flex" }}>
                                        <HiKey />
                                        <div style={{
                                            position: "absolute",
                                            bottom: "-8px",
                                            right: "-6px",
                                            width: "6px",
                                            height: "6px",
                                            borderRadius: "50%",
                                            backgroundColor: settings.googleApiKey ? "#4caf50" : "#ff6b6b"
                                        }} />
                                    </div>
                                </DialogButton>
                            )}
                            {settings.ocrProvider === 'gemini_vision' && (
                                <DialogButton
                                    onClick={() => {
                                        showModal(
                                            <ApiKeyModal
                                                currentKey={settings.geminiApiKey}
                                                onSave={(key) => updateSetting('geminiApiKey', key, 'Gemini API Key')}
                                                title="Gemini API Key"
                                                description="Enter your free Gemini API key from aistudio.google.com."
                                            />
                                        );
                                    }}
                                    style={{ minWidth: "40px", width: "40px", padding: "10px 0" }}
                                >
                                    <div style={{ position: "relative", display: "inline-flex" }}>
                                        <HiKey />
                                        <div style={{
                                            position: "absolute",
                                            bottom: "-8px",
                                            right: "-6px",
                                            width: "6px",
                                            height: "6px",
                                            borderRadius: "50%",
                                            backgroundColor: settings.geminiApiKey ? "#4caf50" : "#ff6b6b"
                                        }} />
                                    </div>
                                </DialogButton>
                            )}
                        </Focusable>
                    </Field>
                </PanelSectionRow>
                {settings.ocrProvider === 'gemini_vision' && (
                    <GeminiModelSelector
                        selectedModel={settings.geminiModel}
                        hasApiKey={!!settings.geminiApiKey}
                        onChange={(model) => updateSetting('geminiModel', model, 'Gemini model')}
                    />
                )}
                {settings.ocrProvider === 'chromescreenai' && (
                    <ChromeScreenAIManager actionRef={chromescreenaiActionRef} />
                )}
                <PanelSectionRow>
                    <Field
                        focusable={true}
                        childrenContainerWidth="max"
                        childrenLayout="below"
                    >
                        <div style={{ color: "#8b929a", fontSize: "12px", lineHeight: "1.6" }}>
                            {settings.ocrProvider === 'rapidocr' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={steamdeckLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>On-Device (RapidOCR)</span>
                                    </div>
                                    <ProviderRating quality={1} speed={1} />
                                    <div>- Offline recognition, no internet required</div>
                                    <div>- Customizable parameters</div>
                                    <div>- Screenshots do not leave your device</div>
                                    <div>- Experimental support</div>
                                </>
                            )}
                            {settings.ocrProvider === 'chromescreenai' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={chromeLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>On-Device (Chrome Screen AI)</span>
                                    </div>
                                    <ProviderRating quality={3} speed={2} />
                                    <div>- Offline text recognition by Google</div>
                                    <div>- 120 MB one-time download required</div>
                                    <div>- Auto-detects 70+ languages</div>
                                    <div style={{ marginTop: "6px", fontStyle: "italic", color: "#5f6268", fontSize: "10px" }}>
                                        Downloaded on demand from Google's public server
                                    </div>
                                    <div style={{ fontStyle: "italic", color: "#5f6268", fontSize: "10px" }}>
                                        This plugin is not affiliated with or endorsed by Google
                                    </div>
                                </>
                            )}
                            {settings.ocrProvider === 'ocrspace' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={ocrspaceLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>OCR.space</span>
                                    </div>
                                    <ProviderRating quality={2} speed={3} />
                                    <div>- Free EU-based cloud OCR API</div>
                                    <div>- Max usage limits: 500/day and 10/10min</div>
                                </>
                            )}
                            {settings.ocrProvider === 'googlecloud' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={googlecloudLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Google Cloud Vision</span>
                                    </div>
                                    <ProviderRating quality={3} speed={3} />
                                    <div>- Best accuracy and speed available</div>
                                    <div>- Ideal for complex/stylized text</div>
                                    <div>- Requires API key</div>
                                    {!settings.googleApiKey && (
                                        <div style={{ color: "#ff6b6b", marginTop: "4px" }}>You need to add your API Key</div>
                                    )}
                                </>
                            )}
                            {settings.ocrProvider === 'gemini_vision' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={geminiLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Gemini Vision</span>
                                    </div>
                                    <ProviderRating quality={3} speed={1} />
                                    <div>- AI-based Recognition and Translation</div>
                                    <div>- Great accuracy, context-aware translations</div>
                                    <div>- Free API key available at aistudio.google.com</div>
                                    {!settings.geminiApiKey && (
                                        <div style={{ color: "#ff6b6b", marginTop: "4px" }}>You need to add your Gemini API Key</div>
                                    )}
                                </>
                            )}
                        </div>
                    </Field>
                </PanelSectionRow>

                {settings.ocrProvider === 'rapidocr' && (
                    <PanelSectionRow>
                        <ToggleField
                            label="Faster Recognition"
                            description="Keeps the recognition engine loaded in memory between translations"
                            checked={settings.rapidocrPersistentMode}
                            onChange={(value) => {
                                updateSetting('rapidocrPersistentMode', value, 'Faster recognition');
                            }}
                        />
                    </PanelSectionRow>
                )}

                {settings.ocrProvider === 'chromescreenai' && (
                    <PanelSectionRow>
                        <ToggleField
                            label="Faster Recognition"
                            description="Keeps the recognition engine loaded in memory between translations"
                            checked={settings.chromeScreenAiPersistentMode}
                            onChange={(value) => {
                                updateSetting('chromeScreenAiPersistentMode', value, 'Faster recognition');
                            }}
                        />
                    </PanelSectionRow>
                )}

                {settings.ocrProvider !== 'ocrspace' && settings.ocrProvider !== 'gemini_vision' && settings.ocrProvider !== 'chromescreenai' && (
                    <PanelSectionRow>
                        <ToggleField
                            label="Customize Recognition"
                            description="Fine-tune text recognition parameters. Can make things better or worse"
                            checked={settings.customRecognitionSettings}
                            onChange={(value) => {
                                updateSetting('customRecognitionSettings', value, 'Custom recognition settings');
                                if (!value) {
                                    updateSetting('rapidocrConfidence', 0.5, 'RapidOCR confidence');
                                    updateSetting('rapidocrBoxThresh', 0.5, 'RapidOCR box threshold');
                                    updateSetting('rapidocrUnclipRatio', 1.6, 'RapidOCR unclip ratio');
                                    updateSetting('confidenceThreshold', 0.6, 'Text recognition confidence');
                                }
                            }}
                        />
                    </PanelSectionRow>
                )}

                {settings.customRecognitionSettings && settings.ocrProvider === 'rapidocr' && (
                    <>
                        <PanelSectionRow>
                            <SliderField
                                value={settings.rapidocrConfidence ?? 0.5}
                                max={1.0}
                                min={0.0}
                                step={0.05}
                                label="Recognition Confidence"
                                description="Higher = less noise but may miss text. Lower = more text but more errors"
                                showValue={true}
                                onChange={(value) => {
                                    updateSetting('rapidocrConfidence', value, 'RapidOCR confidence');
                                }}
                            />
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <SliderField
                                value={settings.rapidocrBoxThresh ?? 0.5}
                                max={1.0}
                                min={0.1}
                                step={0.05}
                                label="Detection Sensitivity"
                                description="Lower = finds more text regions, better for small text. Higher = fewer regions, but more confident detections"
                                showValue={true}
                                onChange={(value) => {
                                    updateSetting('rapidocrBoxThresh', value, 'RapidOCR box threshold');
                                }}
                            />
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <SliderField
                                value={settings.rapidocrUnclipRatio ?? 1.6}
                                max={3.0}
                                min={1.0}
                                step={0.1}
                                label="Box Expansion"
                                description="Higher = larger text boxes, helps capture full words. Lower = tighter boxes around text"
                                showValue={true}
                                onChange={(value) => {
                                    updateSetting('rapidocrUnclipRatio', value, 'RapidOCR unclip ratio');
                                }}
                            />
                        </PanelSectionRow>
                    </>
                )}

                {settings.customRecognitionSettings && settings.ocrProvider === 'googlecloud' && (
                    <PanelSectionRow>
                        <SliderField
                            value={settings.confidenceThreshold}
                            max={1.0}
                            min={0.0}
                            step={0.05}
                            label="Text Recognition Confidence"
                            description="Minimum confidence level for detected text (higher = fewer false positives)"
                            showValue={true}
                            valueSuffix=""
                            onChange={(value) => {
                                updateSetting('confidenceThreshold', value, 'Text recognition confidence');
                            }}
                        />
                    </PanelSectionRow>
                )}

            </PanelSection>

            <PanelSection title="Translation">
                <PanelSectionRow>
                    <Field
                        label="Text Translation Method"
                        childrenContainerWidth="max"
                        childrenLayout="below"
                        focusable={false}
                    >
                        {settings.ocrProvider === 'gemini_vision' ? (
                            <Dropdown
                                rgOptions={[
                                    { label: <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><HiLockClosed style={{ fontSize: "12px", color: "#888" }} /> Gemini Vision <BsStars style={{ fontSize: "12px" }} /></span>, data: "gemini_vision" }
                                ]}
                                selectedOption="gemini_vision"
                                disabled={true}
                                onChange={() => {}}
                            />
                        ) : (
                        <Focusable style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <div style={{ flex: 1 }}>
                                <Dropdown
                                    rgOptions={[
                                        { label: <span>On-Device</span>, data: "ct2" },
                                        { label: <span>Google Translate</span>, data: "freegoogle" },
                                        { label: <span>Google Cloud</span>, data: "googlecloud" }
                                    ]}
                                    selectedOption={settings.translationProvider}
                                    onChange={(option) => updateSetting('translationProvider', option.data, 'Translation provider')}
                                />
                            </div>
                            {settings.translationProvider === 'googlecloud' && (
                                <DialogButton
                                    onClick={() => {
                                        showModal(
                                            <ApiKeyModal
                                                currentKey={settings.googleApiKey}
                                                onSave={(key) => updateSetting('googleApiKey', key, 'Google API Key')}
                                                title="Google Cloud API Key"
                                                description="Enter your Google Cloud API key for Translation services."
                                            />
                                        );
                                    }}
                                    style={{ minWidth: "40px", width: "40px", padding: "10px 0" }}
                                >
                                    <div style={{ position: "relative", display: "inline-flex" }}>
                                        <HiKey />
                                        <div style={{
                                            position: "absolute",
                                            bottom: "-8px",
                                            right: "-6px",
                                            width: "6px",
                                            height: "6px",
                                            borderRadius: "50%",
                                            backgroundColor: settings.googleApiKey ? "#4caf50" : "#ff6b6b"
                                        }} />
                                    </div>
                                </DialogButton>
                            )}
                        </Focusable>
                        )}
                    </Field>
                </PanelSectionRow>

                {settings.ocrProvider !== 'gemini_vision' && settings.translationProvider === 'ct2' && (
                    <CT2ModelManager actionRef={ct2ActionRef} />
                )}

                <PanelSectionRow>
                    <Field
                        focusable={true}
                        childrenContainerWidth="max"
                        childrenLayout="below"
                    >
                        <div style={{ color: "#8b929a", fontSize: "12px", lineHeight: "1.6" }}>
                            {settings.ocrProvider === 'gemini_vision' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={geminiLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Gemini Vision</span>
                                    </div>
                                    <ProviderRating quality={3} speed={1} />
                                    <div>- Translation is handled by Gemini Vision</div>
                                    <div>- OCR and translation happen in a single step</div>
                                </>
                            )}
                            {settings.ocrProvider !== 'gemini_vision' && settings.translationProvider === 'freegoogle' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={googletranslateLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Google Translate</span>
                                    </div>
                                    <ProviderRating quality={2} speed={3} />
                                    <div>- Free, no API key needed</div>
                                    <div>- Good quality for most languages</div>
                                </>
                            )}
                            {settings.ocrProvider !== 'gemini_vision' && settings.translationProvider === 'googlecloud' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={googlecloudLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Google Cloud Translation</span>
                                    </div>
                                    <ProviderRating quality={3} speed={3} />
                                    <div>- High quality translations</div>
                                    <div>- Requires API key</div>
                                    {!settings.googleApiKey && (
                                        <div style={{ color: "#ff6b6b", marginTop: "4px" }}>You need to add your API Key</div>
                                    )}
                                </>
                            )}
                            {settings.ocrProvider !== 'gemini_vision' && settings.translationProvider === 'ct2' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={steamdeckLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>On-Device (NLLB)</span>
                                    </div>
                                    <ProviderRating quality={1} speed={1} />
                                    <div>- Offline translation</div>
                                    <div>- Privacy-friendly</div>
                                    <div>- One-time ~1.4 GB download required</div>
                                    <div>- Single model covers most languages</div>
                                    <div>- Language auto-detect not supported</div>
                                    <div>- Experimental support</div>
                                </>
                            )}
                        </div>
                    </Field>
                </PanelSectionRow>

                {/* Invisible spacer to help with scroll when focusing last element */}
                <PanelSectionRow>
                    <Focusable
                        style={{ height: "1px", opacity: 0 }}
                        onActivate={() => {}}
                    />
                </PanelSectionRow>
            </PanelSection>
        </div>
    );
};
