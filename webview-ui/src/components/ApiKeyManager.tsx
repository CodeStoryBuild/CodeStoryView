import { useState, useEffect, useMemo, CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Eye,
  EyeOff,
  Settings,
  X,
  ExternalLink,
  Check,
  ChevronsUpDown,
  Trash2,
  Plus,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getVsCodeApi } from "@/lib/vscode";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";

import {
  PROVIDER_MODELS,
  GET_KEY_LINKS,
  GLOBAL_OPTIONS,
} from "@/lib/constants";

const STORAGE_KEYS = {
  PROVIDER: "vibe_selected_provider",
  MODEL: "vibe_selected_model",
  GLOBAL_CONFIG: "vibe_global_config",
};

export function ApiKeyManager({
  open,
  onOpenChange,
  onConfigurationChange,
  currentProvider,
  currentModel,
  currentGlobalConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigurationChange: (config: {
    provider: string;
    model: string;
    globalConfig: Record<string, any>;
  }) => void;
  currentProvider?: string;
  currentModel?: string;
  currentGlobalConfig?: Record<string, any>;
}) {
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelQuery, setModelQuery] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [globalConfig, setGlobalConfig] = useState<Record<string, any>>({
    auto_accept: true,
    ...(currentGlobalConfig || {}),
  });
  const [error, setError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [addOptionOpen, setAddOptionOpen] = useState(false);
  const [newlyAddedKey, setNewlyAddedKey] = useState<string | null>(null);
  const vscode = getVsCodeApi();

  // Helper to get entries for the UI
  const configEntries = useMemo(() => {
    return Object.entries(globalConfig).reverse();
  }, [globalConfig]);

  // Reset newlyAddedKey when the manager is closed
  useEffect(() => {
    if (!open) {
      setNewlyAddedKey(null);
    }
  }, [open]);

  // When model popover opens, initialize query to the selected model so it can be edited
  useEffect(() => {
    if (modelOpen) {
      setModelQuery(selectedModel || "");
    }
  }, [modelOpen, selectedModel]);

  // Initialize from incoming props (provider and model are separate now)
  useEffect(() => {
    if (currentProvider) {
      setSelectedProvider(currentProvider);
    }
    if (currentModel) {
      setSelectedModel(currentModel);
      setModelQuery(currentModel);
    } else {
      // If no model provided, ensure modelQuery reflects selectedModel
      setModelQuery(selectedModel);
    }
  }, [currentProvider, currentModel]);

  // Load saved configuration on mount (provider and model stored separately)
  useEffect(() => {
    const savedProvider = localStorage.getItem(STORAGE_KEYS.PROVIDER);
    const savedModel = localStorage.getItem(STORAGE_KEYS.MODEL);

    if (savedProvider) {
      setSelectedProvider(savedProvider);
    }
    if (savedModel) {
      setSelectedModel(savedModel);
      setModelQuery(savedModel);
    }

    // Request global config from extension (SecretStorage)
    vscode.postMessage({ command: "getGlobalConfig" });
  }, []);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "globalConfig") {
        if (message.config) {
          const { api_key, ...restConfig } = message.config;
          const mergedConfig = { auto_accept: true, ...restConfig };
          setGlobalConfig(mergedConfig);
          if (api_key) setApiKey(api_key);
          onConfigurationChange({
            provider: selectedProvider,
            model: selectedModel,
            globalConfig: { ...mergedConfig, api_key },
          });
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [selectedProvider, selectedModel, onConfigurationChange]);

  const handleProviderChange = (newProvider: string) => {
    setSelectedProvider(newProvider);
    // Leave model blank for user to select
    setSelectedModel("");
    setModelQuery("");
    setError("");

    localStorage.setItem(STORAGE_KEYS.PROVIDER, newProvider);
    localStorage.removeItem(STORAGE_KEYS.MODEL);

    onConfigurationChange({
      provider: newProvider,
      model: "",
      globalConfig: globalConfig,
    });
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    setModelQuery(newModel);
    setError("");

    localStorage.setItem(STORAGE_KEYS.MODEL, newModel);

    onConfigurationChange({
      provider: selectedProvider,
      model: newModel,
      globalConfig: { ...globalConfig, api_key: apiKey },
    });
  };

  const handleApiKeyChange = (newKey: string) => {
    setApiKey(newKey);
    setError("");

    // Save to extension (SecretStorage)
    vscode.postMessage({
      command: "setGlobalConfig",
      config: { ...globalConfig, api_key: newKey },
    });

    onConfigurationChange({
      provider: selectedProvider,
      model: selectedModel,
      globalConfig: { ...globalConfig, api_key: newKey },
    });
  };

  const handleGlobalConfigChange = (newConfig: Record<string, any>) => {
    setGlobalConfig(newConfig);
    setError("");

    // Save to extension (SecretStorage)
    vscode.postMessage({
      command: "setGlobalConfig",
      config: { ...newConfig, api_key: apiKey },
    });

    onConfigurationChange({
      provider: selectedProvider,
      model: selectedModel,
      globalConfig: { ...newConfig, api_key: apiKey },
    });
  };

  const updateConfigValue = (key: string, value: any) => {
    const newConfig = { ...globalConfig };
    if (key) {
      newConfig[key] = value;
      handleGlobalConfigChange(newConfig);
    }
  };

  const removeConfigKey = (key: string) => {
    const newConfig = { ...globalConfig };
    delete newConfig[key];
    if (key === newlyAddedKey) setNewlyAddedKey(null);
    handleGlobalConfigChange(newConfig);
  };

  const handleSave = () => {
    setError("");
    // Persist provider and model separately
    localStorage.setItem(STORAGE_KEYS.PROVIDER, selectedProvider);
    localStorage.setItem(STORAGE_KEYS.MODEL, selectedModel);

    onConfigurationChange({
      provider: selectedProvider,
      model: selectedModel,
      globalConfig: { ...globalConfig, api_key: apiKey },
    });
    onOpenChange(false);
  };

  const isValid = true;

  // Memoize inline style object to prevent re-renders
  const titleStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily:
        'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
    }),
    [],
  );

  if (!open) return null;

  const providers = Object.keys(PROVIDER_MODELS);
  const models = PROVIDER_MODELS[selectedProvider] || [];
  const getKeyUrl = GET_KEY_LINKS[selectedProvider];

  return (
    <div className="fixed bottom-16 left-2 sm:left-4 right-2 sm:right-auto z-50 animate-in slide-in-from-bottom-2 duration-200 sm:max-w-[calc(100vw-2rem)]">
      <Card className="w-full sm:w-96 max-w-full shadow-xl border border-border bg-card/95 backdrop-blur-md flex flex-col max-h-[calc(100vh-8rem)] gap-0 py-0 overflow-hidden">
        <CardHeader className="pt-3 sm:pt-4 pb-2 px-3 shrink-0 border-b relative">
          <div className="flex items-center justify-between">
            {/* Title now has 0 height impact */}
            <CardTitle
              className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider opacity-70 flex-1 text-center leading-none"
              style={titleStyle}
            >
              Run Config
            </CardTitle>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              /* CHANGED: top-1 instead of top-4, and h-5 instead of h-6 */
              className="h-5 w-5 opacity-50 hover:opacity-100 absolute right-2 top-1"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0 flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-3 p-3 sm:p-4 pt-2">
              <div className="flex gap-2">
                {/* Provider Selection */}
                <div className="flex-1 space-y-1.5">
                  <Label className="text-[10px] font-medium uppercase tracking-wider opacity-70">
                    Provider
                  </Label>
                  <Popover open={providerOpen} onOpenChange={setProviderOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={providerOpen}
                        className="w-full h-8 justify-between text-xs px-2"
                      >
                        {selectedProvider}
                        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[160px] p-0">
                      <Command>
                        <CommandInput
                          placeholder="Search provider..."
                          className="h-8 text-xs"
                        />
                        <CommandList>
                          <CommandEmpty>No provider found.</CommandEmpty>
                          <CommandGroup>
                            {providers.map((p) => (
                              <CommandItem
                                key={p}
                                value={p}
                                onSelect={(currentValue) => {
                                  handleProviderChange(currentValue);
                                  setProviderOpen(false);
                                }}
                                className="text-xs"
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-3 w-3",
                                    selectedProvider === p
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {p}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Model Selection */}
                <div className="flex-1 space-y-1.5">
                  <Label className="text-[10px] font-medium uppercase tracking-wider opacity-70">
                    Model
                  </Label>
                  <Popover open={modelOpen} onOpenChange={setModelOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={modelOpen}
                        className="w-full h-8 justify-between text-xs px-2"
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="truncate">{selectedModel}</span>
                          {/** Blue indicator if model is a custom value not in provider list */}
                          {!models.includes(selectedModel) && (
                            <span
                              className="ml-auto h-2 w-2 rounded-full bg-info"
                              title="Custom model"
                            />
                          )}
                        </div>
                        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[160px] p-0">
                      <Command>
                        <CommandInput
                          placeholder="Search model..."
                          className="h-8 text-xs"
                          value={modelQuery}
                          onValueChange={(v) => setModelQuery(v)}
                          onKeyDown={(e: any) => {
                            if (e.key === "Enter") {
                              const val = modelQuery.trim();
                              if (val.length > 0) {
                                handleModelChange(val);
                                setModelOpen(false);
                              }
                            }
                          }}
                        />
                        <CommandList>
                          {/* If query doesn't match any model, show a quick 'use custom' option */}
                          {modelQuery &&
                            !models.includes(modelQuery) &&
                            modelQuery.trim().length > 0 && (
                              <CommandItem
                                value={modelQuery}
                                onSelect={(currentValue) => {
                                  handleModelChange(currentValue);
                                  setModelOpen(false);
                                }}
                                className="text-xs"
                              >
                                <Check className="mr-2 h-3 w-3 text-info" />
                                <span className="text-info">Use custom</span>
                                <span className="ml-2 truncate">
                                  {modelQuery}
                                </span>
                              </CommandItem>
                            )}

                          <CommandEmpty>No model found.</CommandEmpty>

                          <CommandGroup>
                            {models.map((m) => (
                              <CommandItem
                                key={m}
                                value={m}
                                onSelect={(currentValue) => {
                                  handleModelChange(currentValue);
                                  setModelOpen(false);
                                }}
                                className="text-xs"
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-3 w-3",
                                    selectedModel === m
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {m}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* API Key Input */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label className="text-[10px] font-medium uppercase tracking-wider opacity-70">
                    API Key (Optional)
                  </Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 opacity-50 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[200px] text-[11px]">
                        Optional. The API key will be used to authenticate your
                        requests to Codestory. Can also use CODESTORY_API_KEY
                        env variable.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    placeholder="Enter API key..."
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    className="h-8 text-xs pr-16"
                  />
                  <div className="absolute right-0 top-0 h-full flex items-center pr-1.5 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-50 hover:opacity-100"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3" />
                      )}
                    </Button>
                    {getKeyUrl && (
                      <a
                        href={getKeyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 opacity-50 hover:opacity-100 text-primary"
                        title={`Get ${selectedProvider} API key`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Global Config Options */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-medium uppercase tracking-wider opacity-70">
                    Global Options
                  </Label>
                  <Popover open={addOptionOpen} onOpenChange={setAddOptionOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] gap-1 opacity-70 hover:opacity-100"
                      >
                        <Plus className="h-3 w-3" />
                        Add Option
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[240px] p-0" align="end">
                      <Command>
                        <CommandInput
                          placeholder="Search options..."
                          className="h-8 text-xs"
                        />
                        <CommandList>
                          <CommandEmpty>No option found.</CommandEmpty>
                          <CommandGroup>
                            {Object.keys(GLOBAL_OPTIONS)
                              .filter((k) => !globalConfig.hasOwnProperty(k))
                              .map((k) => (
                                <CommandItem
                                  key={k}
                                  value={k}
                                  onSelect={(newKey) => {
                                    const newOption = GLOBAL_OPTIONS[newKey];
                                    let defaultValue: any = "";
                                    if (newOption.type === "boolean")
                                      defaultValue = false;
                                    if (newOption.type === "number")
                                      defaultValue = newOption.min ?? 0;
                                    if (newOption.type === "literal")
                                      defaultValue =
                                        newOption.allowed?.[0] ?? "";

                                    const newConfig = { ...globalConfig };
                                    newConfig[newKey] = defaultValue;
                                    setNewlyAddedKey(newKey);
                                    handleGlobalConfigChange(newConfig);
                                    setAddOptionOpen(false);
                                  }}
                                  className="text-xs"
                                >
                                  {k}
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  {configEntries.map(([key, value], index) => {
                    const option = GLOBAL_OPTIONS[key];

                    return (
                      <div
                        key={key}
                        className={cn(
                          "group relative flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-muted/20 transition-all duration-300",
                          key === newlyAddedKey &&
                            "border-primary/50 bg-primary/5 shadow-[0_0_12px_rgba(var(--primary),0.1)]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold tracking-tight">
                                {key}
                              </span>
                              {option?.type === "number" && (
                                <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground font-mono">
                                  num
                                </span>
                              )}
                            </div>
                            {option && (
                              <p className="text-[10px] text-muted-foreground leading-normal">
                                {option.description}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 -mr-1 -mt-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            onClick={() => removeConfigKey(key)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        <div className="flex items-center justify-end mt-1">
                          {option ? (
                            option.type === "boolean" ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-medium opacity-50">
                                  {value ? "Enabled" : "Disabled"}
                                </span>
                                <Switch
                                  checked={!!value}
                                  onCheckedChange={(checked) =>
                                    updateConfigValue(key, checked)
                                  }
                                  className="scale-75 origin-right"
                                />
                              </div>
                            ) : option.type === "literal" ? (
                              <Select
                                value={value}
                                onValueChange={(v) => updateConfigValue(key, v)}
                              >
                                <SelectTrigger className="h-7 text-[11px] w-full bg-background/50">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {option.allowed?.map((v) => (
                                    <SelectItem
                                      key={v}
                                      value={v}
                                      className="text-[11px]"
                                    >
                                      {v}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="w-full relative">
                                <Input
                                  type={
                                    option.type === "number" ? "number" : "text"
                                  }
                                  value={value}
                                  onChange={(e) => {
                                    let val: any = e.target.value;
                                    if (option.type === "number") {
                                      val = option.is_int
                                        ? parseInt(val)
                                        : parseFloat(val);
                                      if (isNaN(val)) val = 0;
                                    }
                                    updateConfigValue(key, val);
                                  }}
                                  className="h-7 text-[11px] w-full bg-background/50 pr-8"
                                  step={
                                    option.type === "number" && !option.is_int
                                      ? "0.1"
                                      : "1"
                                  }
                                  min={option.min}
                                  max={option.max}
                                />
                                {option.type === "number" && (
                                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col opacity-30">
                                    <ChevronsUpDown className="h-2 w-2" />
                                  </div>
                                )}
                              </div>
                            )
                          ) : (
                            <div className="text-[11px] font-mono opacity-50 bg-muted px-2 py-0.5 rounded">
                              {String(value)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 pt-0 space-y-4 shrink-0">
            {/* Error Display */}
            {error && (
              <Alert variant="destructive" className="py-1.5 px-2">
                <AlertDescription className="text-[10px]">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {/* Save Button */}
            <Button
              onClick={handleSave}
              disabled={!isValid}
              className="w-full h-8 text-xs font-medium"
            >
              Save Configuration
            </Button>
          </div>
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
      size="icon"
      onClick={onClick}
      className={cn(
        "fixed bottom-4 left-4 z-40 rounded-full h-10 w-10 shadow-lg border-border bg-background/80 backdrop-blur-sm hover:bg-accent transition-all",
        isConfigured ? "border-success/50" : "border-border",
      )}
    >
      <Settings
        className={cn(
          "h-5 w-5",
          isConfigured ? "text-success" : "text-muted-foreground",
        )}
      />
    </Button>
  );
}
