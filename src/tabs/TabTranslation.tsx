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

import { VFC, useState, useEffect } from "react";
import { call } from "@decky/api";
import { useSettings } from "../SettingsContext";
import { HiKey, HiArrowPath } from "react-icons/hi2";

// @ts-ignore
import ocrspaceLogo from "../../assets/ocrspace-logo.png";
// @ts-ignore
import googlecloudLogo from "../../assets/googlecloud-logo.png";
// @ts-ignore
import googletranslateLogo from "../../assets/googletranslate-logo.png";
// @ts-ignore
import rapidocrLogo from "../../assets/rapidocr-logo.png";
// @ts-ignore
import geminiLogo from "../../assets/gemini-logo.png";

// Language options with flag emojis
const languageOptions = [
    { label: "🌐 Auto-detect", data: "auto" },
    { label: "🇬🇧 English", data: "en" },
    { label: "🇪🇸 Spanish", data: "es" },
    { label: "🇫🇷 French", data: "fr" },
    { label: "🇩🇪 German", data: "de" },
    { label: "🇬🇷 Greek", data: "el" },
    { label: "🇮🇹 Italian", data: "it" },
    { label: "🇵🇹 Portuguese", data: "pt" },
    { label: "🇷🇺 Russian", data: "ru" },
    { label: "🇯🇵 Japanese", data: "ja" },
    { label: "🇰🇷 Korean", data: "ko" },
    { label: "🇨🇳 Chinese (Simplified)", data: "zh-CN" },
    { label: "🇹🇼 Chinese (Traditional)", data: "zh-TW" },
    { label: "🇸🇦 Arabic", data: "ar" },
    { label: "🇫🇮 Finnish", data: "fi" },
    { label: "🇳🇱 Dutch", data: "nl" },
    { label: "🇮🇳 Hindi", data: "hi" },
    { label: "🇵🇱 Polish", data: "pl" },
    { label: "🇹🇭 Thai", data: "th" },
    { label: "🇹🇷 Turkish", data: "tr" },
    { label: "🇺🇦 Ukrainian", data: "uk" },
    { label: "🇷🇴 Romanian", data: "ro" },
    { label: "🇻🇳 Vietnamese", data: "vi" },
    { label: "🇧🇬 Bulgarian", data: "bg" }
];

const selectLanguageOption = { label: "Select language...", data: "" };
const outputLanguageOptions = languageOptions.filter(lang => lang.data !== "auto");

// Languages RapidOCR able to work with
const rapidocrLanguages = new Set([
    'en', 'zh-CN', 'zh-TW', 'ja', 'ko',
    'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'tr', 'ro', 'vi', 'fi',
    'ru', 'uk', 'el', 'th', 'bg'
]);

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
            const available = await call<string[]>('get_gemini_models');
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
                    childrenContainerWidth="fixed"
                    focusable={false}
                >
                    <Focusable style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <Dropdown
                            rgOptions={models}
                            selectedOption={selectedModel}
                            onChange={(option) => onChange(option.data)}
                        />
                        <DialogButton
                            onClick={validateModels}
                            disabled={loading || !hasApiKey}
                            style={{ minWidth: "40px", width: "40px", padding: "10px 0" }}
                        >
                            <HiArrowPath style={loading ? { animation: "gemini-spin 1s linear infinite" } : {}} />
                        </DialogButton>
                    </Focusable>
                </Field>
            </PanelSectionRow>
        </>
    );
};

export const TabTranslation: VFC = () => {
    const { settings, updateSetting } = useSettings();

    const placeholderOption = settings.inputLanguage === '' ? [selectLanguageOption] : [];
    const inputLanguageOptions = settings.ocrProvider === 'rapidocr'
        ? [...placeholderOption, ...languageOptions.filter(lang => rapidocrLanguages.has(lang.data))]
        : [...placeholderOption, ...languageOptions];

    // Reset input language if it's not supported by the current OCR provider
    useEffect(() => {
        if (settings.initialized && settings.ocrProvider === 'rapidocr'
            && settings.inputLanguage !== '' && !rapidocrLanguages.has(settings.inputLanguage)) {
            updateSetting('inputLanguage', '', 'Input language');
        }
    }, [settings.initialized, settings.ocrProvider]);

    return (
        <div style={{ marginLeft: "-8px", marginRight: "-8px", paddingBottom: "40px" }}>
            <PanelSection title="Languages">
                <PanelSectionRow>
                    <DropdownItem
                        label="Input Language"
                        description={settings.ocrProvider === 'rapidocr'
                            ? "Source language for text recognition"
                            : "Source language (Select auto-detect if unsure)"}
                        rgOptions={inputLanguageOptions}
                        selectedOption={settings.inputLanguage}
                        onChange={(option) => updateSetting('inputLanguage', option.data, 'Input language')}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <DropdownItem
                        label="Output Language"
                        description="Target language for translation"
                        rgOptions={[...(settings.targetLanguage === '' ? [selectLanguageOption] : []), ...outputLanguageOptions]}
                        selectedOption={settings.targetLanguage}
                        onChange={(option) => updateSetting('targetLanguage', option.data, 'Output language')}
                    />
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title="Recognition">
                {/* OCR Provider Selection */}
                <PanelSectionRow>
                    <Field
                        label="Text Recognition Method"
                        childrenContainerWidth="fixed"
                        focusable={false}
                    >
                        <Focusable style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <Dropdown
                                rgOptions={[
                                    { label: <span>RapidOCR</span>, data: "rapidocr" },
                                    { label: <span>OCR.space</span>, data: "ocrspace" },
                                    { label: <span>Google Cloud</span>, data: "googlecloud" },
                                    { label: <span>Gemini Vision</span>, data: "gemini_vision" }
                                ]}
                                selectedOption={settings.ocrProvider}
                                onChange={(option) => {
                                    updateSetting('ocrProvider', option.data, 'OCR provider');
                                    if (option.data === 'rapidocr' && settings.inputLanguage !== '' && !rapidocrLanguages.has(settings.inputLanguage)) {
                                        updateSetting('inputLanguage', '', 'Input language');
                                    }
                                }}
                            />
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
                <PanelSectionRow>
                    <Field
                        focusable={true}
                        childrenContainerWidth="max"
                    >
                        <div style={{ color: "#8b929a", fontSize: "12px", lineHeight: "1.6" }}>
                            {settings.ocrProvider === 'rapidocr' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={rapidocrLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>RapidOCR</span>
                                    </div>
                                    <div>- On-Device Text Recognition</div>
                                    <div>- Average accuracy and slower than web-based options</div>
                                    <div>- Customizable parameters</div>
                                    <div>- Screenshots do not leave your device</div>
                                </>
                            )}
                            {settings.ocrProvider === 'ocrspace' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={ocrspaceLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>OCR.space</span>
                                    </div>
                                    <div>- Free EU-based cloud OCR API</div>
                                    <div>- Max usage limits: 500/day and 10/10min</div>
                                    <div>- Provides good speed and results</div>
                                </>
                            )}
                            {settings.ocrProvider === 'googlecloud' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={googlecloudLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Google Cloud Vision</span>
                                    </div>
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
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Gemini Vision (Google AI)</span>
                                    </div>
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

                {settings.ocrProvider !== 'ocrspace' && settings.ocrProvider !== 'gemini_vision' && (
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
                        childrenContainerWidth="fixed"
                        focusable={false}
                    >
                        {settings.ocrProvider === 'gemini_vision' ? (
                            <Dropdown
                                rgOptions={[
                                    { label: <span>Gemini Vision</span>, data: "gemini_vision" }
                                ]}
                                selectedOption="gemini_vision"
                                disabled={true}
                                onChange={() => {}}
                            />
                        ) : (
                        <Focusable style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <Dropdown
                                rgOptions={[
                                    { label: <span>Google Translate</span>, data: "freegoogle" },
                                    { label: <span>Google Cloud</span>, data: "googlecloud" }
                                ]}
                                selectedOption={settings.translationProvider}
                                onChange={(option) => updateSetting('translationProvider', option.data, 'Translation provider')}
                            />
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
                <PanelSectionRow>
                    <Field
                        focusable={true}
                        childrenContainerWidth="max"
                    >
                        <div style={{ color: "#8b929a", fontSize: "12px", lineHeight: "1.6" }}>
                            {settings.ocrProvider === 'gemini_vision' && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                        <img src={geminiLogo} alt="" style={{ height: "18px" }} />
                                        <span style={{ fontWeight: "bold", color: "#dcdedf" }}>Gemini Vision</span>
                                    </div>
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
                                    <div>- High quality translations</div>
                                    <div>- Very quick</div>
                                    <div>- Requires API key</div>
                                    {!settings.googleApiKey && (
                                        <div style={{ color: "#ff6b6b", marginTop: "4px" }}>You need to add your API Key</div>
                                    )}
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
