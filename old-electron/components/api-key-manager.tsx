"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eye, EyeOff, Settings, X, ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Model {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

interface ApiKeyManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigurationChange: (config: { model: string; apiKey: string }) => void;
  currentModel?: string;
  currentApiKey?: string;
}

// Available models with provider mappings (stored as provider:modelname)
export const AVAILABLE_MODELS: Model[] = [
  // Google
  {
    id: "google:gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "Google",
    description:
      "An ultra lightweight and fast model, also great at quick tasks.",
  },
  {
    id: "google:gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    description: "Google's most intelligent and capable model yet.",
  },
  {
    id: "google:gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    description:
      "A lighter weight model optimized for high-speed, high-volume tasks.",
  },

  // OpenAI
  {
    id: "openai:gpt-5.1-thinking",
    name: "GPT-5.1 Thinking",
    provider: "OpenAI",
    description: "OpenAI's most advanced reasoning model.",
  },
  {
    id: "openai:gpt-5.1-instant",
    name: "GPT-5.1 Instant",
    provider: "OpenAI",
    description:
      "A highly intelligent and conversational model, better at following instructions than previous versions.",
  },
  {
    id: "openai:gpt-5-mini",
    name: "GPT-5-Mini",
    provider: "OpenAI",
    description: "Latest fast and cost-effective model.",
  },
  {
    id: "openai:gpt-4.1",
    name: "GPT-4.1",
    provider: "OpenAI",
    description: "A fast, cheap, and reliable model.",
  },

  // Anthropic
  {
    id: "anthropic:claude-4.5-sonnet",
    name: "Claude 4.5 Sonnet",
    provider: "Anthropic",
    description: "The smartest Claude model for complex analysis of code.",
  },
  {
    id: "anthropic:claude-4.1-opus",
    name: "Claude 4.1 Opus",
    provider: "Anthropic",
    description: "An exceptional model for specialized, deep reasoning.",
  },
  {
    id: "anthropic:claude-4.5-haiku",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Anthropic's fastest and most compact model.",
  },
];

/**
 * Parse model ID to extract provider and model name
 */
function parseModelId(modelId: string): {
  provider: string;
  modelName: string;
} {
  const [provider, modelName] = modelId.split(":");
  if (!provider || !modelName) {
    throw new Error(
      `Invalid model ID format: ${modelId}. Expected format: provider:modelname`,
    );
  }
  return { provider, modelName };
}

// Provider information for API key guidance
const PROVIDER_INFO = {
  Google: {
    keyFormat: "AIza",
    getKeyUrl: "https://aistudio.google.com/app/apikey",
    keyDescription: "Google AI API key (starts with AIza)",
  },
  OpenAI: {
    keyFormat: "sk-",
    getKeyUrl: "https://platform.openai.com/api-keys",
    keyDescription: "OpenAI API key (starts with sk-)",
  },
  Anthropic: {
    keyFormat: "sk-ant-",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    keyDescription: "Anthropic API key (starts with sk-ant-)",
  },
};

const STORAGE_KEYS = {
  MODEL: "vibe_selected_model",
  API_KEY: "vibe_api_key",
};

export function ApiKeyManager({
  open,
  onOpenChange,
  onConfigurationChange,
  currentModel,
  currentApiKey,
}: ApiKeyManagerProps) {
  const [selectedModel, setSelectedModel] = useState<string>(
    currentModel || AVAILABLE_MODELS[0].id,
  );
  const [apiKey, setApiKey] = useState<string>(currentApiKey || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState("");

  // Load saved configuration on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedModel = localStorage.getItem(STORAGE_KEYS.MODEL);
      const savedApiKey = sessionStorage.getItem(STORAGE_KEYS.API_KEY);

      if (savedModel && AVAILABLE_MODELS.find((m) => m.id === savedModel)) {
        setSelectedModel(savedModel);
      }
      if (savedApiKey) {
        setApiKey(savedApiKey);
      }

      // Try to load from secure store if available
      try {
        if (window.electronAPI?.secureStore?.getApiKey) {
          window.electronAPI.secureStore
            .getApiKey()
            .then((secureApiKey: string | null) => {
              if (secureApiKey) {
                setApiKey(secureApiKey);
              }
            })
            .catch(() => { });
        }
      } catch { }
    }
  }, []);

  // Get the current model object and parse provider info
  const currentModelObj = AVAILABLE_MODELS.find((m) => m.id === selectedModel);
  const providerInfo = currentModelObj
    ? PROVIDER_INFO[currentModelObj.provider as keyof typeof PROVIDER_INFO]
    : null;

  const validateApiKey = (key: string, modelId: string): boolean => {
    if (!key.trim()) return false;

    try {
      const { provider } = parseModelId(modelId);
      const providerKey = provider.charAt(0).toUpperCase() + provider.slice(1); // Capitalize first letter
      const info = PROVIDER_INFO[providerKey as keyof typeof PROVIDER_INFO];
      if (info && !key.startsWith(info.keyFormat)) {
        return false;
      }
    } catch {
      return false;
    }

    return true;
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    setError(""); // Clear error when model changes

    // Save to session storage
    if (typeof window !== "undefined") {
      // Persist last selected model across sessions
      localStorage.setItem(STORAGE_KEYS.MODEL, newModel);
    }

    // Notify parent of configuration change
    onConfigurationChange({
      model: newModel,
      apiKey: apiKey,
    });
  };

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey);
    setError(""); // Clear error when key changes

    // Save to session storage
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_KEYS.API_KEY, newApiKey);
    }

    // Save to secure store if available
    try {
      if (window.electronAPI?.secureStore?.setApiKey) {
        window.electronAPI.secureStore.setApiKey(newApiKey).catch(() => { });
      }
    } catch { }

    // Notify parent of configuration change
    onConfigurationChange({
      model: selectedModel,
      apiKey: newApiKey,
    });
  };

  const handleSave = () => {
    if (!selectedModel) {
      setError("Please select a model");
      return;
    }

    if (!apiKey.trim()) {
      setError("Please enter an API key");
      return;
    }

    if (currentModelObj && !validateApiKey(apiKey, selectedModel)) {
      const info =
        PROVIDER_INFO[currentModelObj.provider as keyof typeof PROVIDER_INFO];
      setError(
        `Invalid API key format for ${currentModelObj.provider}. Expected format: ${info?.keyDescription}`,
      );
      return;
    }

    setError("");
    onConfigurationChange({
      model: selectedModel,
      apiKey: apiKey.trim(),
    });
    onOpenChange(false);
  };

  const isValid =
    selectedModel &&
    apiKey.trim() &&
    (currentModelObj ? validateApiKey(apiKey, selectedModel) : false);

  const getValidationMessage = (): string => {
    if (!selectedModel) {
      return "Please select a model";
    }
    if (!apiKey.trim()) {
      return "Please enter an API key";
    }
    if (currentModelObj && !validateApiKey(apiKey, selectedModel)) {
      const info =
        PROVIDER_INFO[currentModelObj.provider as keyof typeof PROVIDER_INFO];
      return `Invalid API key format for ${currentModelObj.provider}. Expected format: ${info?.keyDescription}`;
    }
    return "Ready to execute vibe commands";
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <Card className="w-96 shadow-lg border">
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">API Configuration</CardTitle>
              <CardDescription className="text-sm">
                Configure your AI model and API key for vibe commands.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Model Selection */}
          <div className="space-y-5">
            <Label htmlFor="model-select">AI Model</Label>
            <Select value={selectedModel} onValueChange={handleModelChange}>
              <SelectTrigger id="model-select">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex flex-col w-full max-w-xs">
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="font-medium">{model.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({model.provider})
                        </span>
                      </div>
                      {model.description && (
                        <span className="text-xs text-muted-foreground break-words whitespace-normal leading-tight mt-1">
                          {model.description}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="api-key">
                API Key {currentModelObj && `(${currentModelObj.provider})`}
              </Label>
              {providerInfo && (
                <a
                  href={providerInfo.getKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
                >
                  Get API Key
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="relative">
              <Input
                id="api-key"
                type={showApiKey ? "text" : "password"}
                placeholder={
                  providerInfo?.keyDescription || "Enter your API key"
                }
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                className="pr-10"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}

          {/* Status Indicator */}
          <div className="flex items-center gap-2 text-sm">
            <div
              className={`w-2 h-2 rounded-full ${isValid ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-muted-foreground">
              {getValidationMessage()}
            </span>
          </div>

          {/* Privacy Note */}
          <Alert>
            <AlertDescription className="text-xs">
              <strong>Privacy:</strong> API key is stored securely and used only
              for vibe commands.
            </AlertDescription>
          </Alert>

          {/* Save Button */}
          <Button onClick={handleSave} disabled={!isValid} className="w-full">
            Save Configuration
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Toggle button component for the git visualizer
interface ApiKeyManagerToggleProps {
  onClick: () => void;
  isConfigured: boolean;
}

export function ApiKeyManagerToggle({
  onClick,
  isConfigured,
}: ApiKeyManagerToggleProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className={`fixed bottom-4 left-4 z-40 shadow-lg ${isConfigured
        ? "border-green-500 bg-green-50 hover:bg-green-100"
        : "border-orange-500 bg-orange-50 hover:bg-orange-100"
        }`}
    >
      <Settings className="h-4 w-4 mr-2" />
      API Config
      <div
        className={`ml-2 w-2 h-2 rounded-full ${isConfigured ? "bg-green-500" : "bg-orange-500"}`}
      />
    </Button>
  );
}
