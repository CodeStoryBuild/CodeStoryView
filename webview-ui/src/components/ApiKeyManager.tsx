import { useState, useEffect, useMemo } from "react";
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
import { Eye, EyeOff, Settings, X, ExternalLink, Check, ChevronsUpDown, Trash2, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getVsCodeApi } from "@/lib/vscode";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const PROVIDER_MODELS: Record<string, string[]> = {
  azure: ['gpt-4', 'gpt-4-32k', 'gpt-35-turbo', 'gpt-35-turbo-16k'],
  fireworks: ['llama-v3-70b-instruct', 'llama-v3-8b-instruct', 'mixtral-8x7b-instruct'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  inception: ['inception-v3'],
  cohere: ['command', 'command-light', 'command-nightly'],
  mistral: ['mistral-tiny', 'mistral-small', 'mistral-medium', 'mistral-large'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  aws: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
  huggingface: ['meta-llama/Llama-2-70b-chat-hf', 'tiiuae/falcon-180B-chat'],
  groq: ['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768'],
  together: ['llama-2-70b-chat', 'mixtral-8x7b-instruct'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
  anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  lmstudio: ['local-model'],
  cerebras: ['llama3.1-8b', 'llama3.1-70b'],
  ollama: ['llama3', 'mistral', 'phi3'],
  sambanova: ['llama3-70b', 'llama3-8b'],
  watsonx: ['granite-13b-chat-v2'],
  nebius: ['llama-3.1-70b-instruct'],
  xai: ['grok-1']
};

const GET_KEY_LINKS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/app/apikey',
  groq: 'https://console.groq.com/keys',
  mistral: 'https://console.mistral.ai/api-keys/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  together: 'https://api.together.xyz/settings/api-keys',
  fireworks: 'https://fireworks.ai/account/api-keys',
  cohere: 'https://dashboard.cohere.com/api-keys',
};

type ConfigOptionType = "string" | "number" | "boolean" | "literal";

interface ConfigOption {
  type: ConfigOptionType;
  allowed?: string[];
  description: string;
  min?: number;
  max?: number;
  is_int?: boolean;
}

const GLOBAL_OPTIONS: Record<string, ConfigOption> = {
  api_key: { type: "string", description: "API key for the LLM provider" },
  api_base: { type: "string", description: "Custom API base URL for the LLM provider (optional)" },
  temperature: { type: "number", description: "Temperature for LLM responses (0.0-1.0)", min: 0.0, max: 1.0 },
  max_tokens: { type: "number", description: "Maximum tokens to send for LLM requests", min: 1, is_int: true },
  secret_scanner_aggression: {
    type: "literal",
    description: "How aggresively to scan for secrets ('cst commit' only)",
    allowed: ["safe", "standard", "strict", "none"]
  },
  fallback_grouping_strategy: {
    type: "literal",
    description: "Strategy for grouping changes that were not able to be analyzed",
    allowed: ["all_together", "by_file_path", "by_file_name", "by_file_extension", "all_alone"]
  },
  chunking_level: {
    type: "literal",
    description: "Which type of changes should be chunked further into smaller pieces",
    allowed: ["none", "full_files", "all_files"]
  },
  verbose: { type: "boolean", description: "Enable verbose logging output" },
  auto_accept: { type: "boolean", description: "Automatically accept all prompts without user confirmation" },
  silent: { type: "boolean", description: "Do not output any text to the console, except for prompting acceptance" },
  ask_for_commit_message: { type: "boolean", description: "Allow asking you to provide commit messages to optionally override the auto generated ones" },
  display_diff_type: {
    type: "literal",
    description: "Type of diff to display when showing diffs (semantic or git)",
    allowed: ["semantic", "git"]
  },
  custom_language_config: { type: "string", description: "Path to custom language configuration JSON file" },
  batching_strategy: {
    type: "literal",
    description: "Strategy for batching LLM requests (auto, requests, prompt)",
    allowed: ["auto", "requests", "prompt"]
  },
  custom_embedding_model: { type: "string", description: "FastEmbed supported text embedding model" },
  cluster_strictness: { type: "number", description: "Strictness of clustering logical groups together (0-1)", min: 0.0, max: 1.0 },
  num_retries: { type: "number", description: "How many times to retry calling a model if it fails (0-10)", min: 0, max: 10, is_int: true },
};

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
  onConfigurationChange: (config: { provider: string; model: string; globalConfig: Record<string, any> }) => void;
  currentProvider?: string;
  currentModel?: string;
  currentGlobalConfig?: Record<string, any>;
}) {
  const [selectedProvider, setSelectedProvider] = useState<string>("openai");
  const [selectedModel, setSelectedModel] = useState<string>("gpt-4o");
  const [modelQuery, setModelQuery] = useState<string>("gpt-4o");
  const [globalConfig, setGlobalConfig] = useState<Record<string, any>>(currentGlobalConfig || {});
  const [error, setError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const vscode = getVsCodeApi();

  // Helper to get entries for the UI (including an empty one at the end)
  const configEntries = useMemo(() => {
    const entries = Object.entries(globalConfig);
    return [...entries, ["", ""]];
  }, [globalConfig]);

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
    vscode.postMessage({ command: 'getGlobalConfig' });
  }, []);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'globalConfig') {
        if (message.config) {
          setGlobalConfig(message.config);
          onConfigurationChange({
            provider: selectedProvider,
            model: selectedModel,
            globalConfig: message.config,
          });
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectedProvider, selectedModel, onConfigurationChange]);

  const handleProviderChange = (newProvider: string) => {
    setSelectedProvider(newProvider);
    const defaultModel = PROVIDER_MODELS[newProvider][0];
    setSelectedModel(defaultModel);
    setModelQuery(defaultModel);
    setError("");

    localStorage.setItem(STORAGE_KEYS.PROVIDER, newProvider);
    localStorage.setItem(STORAGE_KEYS.MODEL, defaultModel);

    onConfigurationChange({
      provider: newProvider,
      model: defaultModel,
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
      globalConfig: globalConfig,
    });
  };

  const handleGlobalConfigChange = (newConfig: Record<string, any>) => {
    setGlobalConfig(newConfig);
    setError("");

    // Save to extension (SecretStorage)
    vscode.postMessage({ command: 'setGlobalConfig', config: newConfig });

    onConfigurationChange({
      provider: selectedProvider,
      model: selectedModel,
      globalConfig: newConfig,
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
      globalConfig: globalConfig,
    });
    onOpenChange(false);
  };

  const isValid = true;

  if (!open) return null;

  const providers = Object.keys(PROVIDER_MODELS);
  const models = PROVIDER_MODELS[selectedProvider] || [];
  const getKeyUrl = GET_KEY_LINKS[selectedProvider];

  return (
    <div className="fixed bottom-16 left-4 z-50 animate-in slide-in-from-bottom-2 duration-200">
      <Card className="w-80 shadow-xl border border-border bg-card/95 backdrop-blur-md">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 text-center">
              <CardTitle className="text-sm font-semibold">Run Config</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-6 w-6 opacity-50 hover:opacity-100 absolute right-2 top-4"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pb-4 px-4">
          <div className="flex gap-2">
            {/* Provider Selection */}
            <div className="flex-1 space-y-1.5">
              <Label className="text-[10px] font-medium uppercase tracking-wider opacity-70">Provider</Label>
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
                    <CommandInput placeholder="Search provider..." className="h-8 text-xs" />
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
                                selectedProvider === p ? "opacity-100" : "opacity-0"
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
              <Label className="text-[10px] font-medium uppercase tracking-wider opacity-70">Model</Label>
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
                      {(!models.includes(selectedModel)) && (
                        <span className="ml-auto h-2 w-2 rounded-full bg-blue-400" title="Custom model" />
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
                      {modelQuery && !models.includes(modelQuery) && modelQuery.trim().length > 0 && (
                        <CommandItem
                          value={modelQuery}
                          onSelect={(currentValue) => {
                            handleModelChange(currentValue);
                            setModelOpen(false);
                          }}
                          className="text-xs"
                        >
                          <Check className="mr-2 h-3 w-3 text-blue-500" />
                          <span className="text-blue-500">Use custom</span>
                          <span className="ml-2 truncate">{modelQuery}</span>
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
                                selectedModel === m ? "opacity-100" : "opacity-0"
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

          {/* Global Config Options */}
          <div className="space-y-2">
            <Label className="text-[10px] font-medium uppercase tracking-wider opacity-70">
              Global Options
            </Label>
            <ScrollArea className="h-[200px] pr-3 -mr-3">
              <div className="space-y-3">
                {configEntries.map(([key, value], index) => {
                  const option = GLOBAL_OPTIONS[key];
                  const isNewRow = key === "";
                  
                  return (
                    <div key={index} className="flex flex-col gap-1.5 p-2 rounded-md border border-border/50 bg-muted/30">
                      <div className="flex items-center justify-between gap-2">
                        <Select
                          value={key}
                          onValueChange={(newKey) => {
                            if (newKey === key) return;
                            const newOption = GLOBAL_OPTIONS[newKey];
                            let defaultValue: any = "";
                            if (newOption.type === "boolean") defaultValue = false;
                            if (newOption.type === "number") defaultValue = newOption.min ?? 0;
                            if (newOption.type === "literal") defaultValue = newOption.allowed?.[0] ?? "";
                            
                            const newConfig = { ...globalConfig };
                            if (key) delete newConfig[key];
                            newConfig[newKey] = defaultValue;
                            handleGlobalConfigChange(newConfig);
                          }}
                        >
                          <SelectTrigger className="h-7 text-[11px] flex-1">
                            <SelectValue placeholder="Select option..." />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.keys(GLOBAL_OPTIONS)
                              .filter(k => k === key || !globalConfig.hasOwnProperty(k))
                              .map(k => (
                                <SelectItem key={k} value={k} className="text-[11px]">
                                  {k}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {!isNewRow && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeConfigKey(key)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>

                      {key && option && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-[10px] text-muted-foreground leading-tight">
                            {option.description}
                          </p>
                          <div className="flex items-center gap-2">
                            {option.type === "boolean" ? (
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={!!value}
                                  onCheckedChange={(checked) => updateConfigValue(key, checked)}
                                />
                                <span className="text-[11px]">{value ? "On" : "Off"}</span>
                              </div>
                            ) : option.type === "literal" ? (
                              <Select
                                value={value}
                                onValueChange={(v) => updateConfigValue(key, v)}
                              >
                                <SelectTrigger className="h-7 text-[11px] w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {option.allowed?.map(v => (
                                    <SelectItem key={v} value={v} className="text-[11px]">
                                      {v}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="relative w-full">
                                <Input
                                  type={key === "api_key" ? "password" : option.type === "number" ? "number" : "text"}
                                  value={value}
                                  onChange={(e) => {
                                    let val: any = e.target.value;
                                    if (option.type === "number") {
                                      val = option.is_int ? parseInt(val) : parseFloat(val);
                                      if (isNaN(val)) val = 0;
                                    }
                                    updateConfigValue(key, val);
                                  }}
                                  className="h-7 text-[11px] pr-8"
                                  step={option.type === "number" && !option.is_int ? "0.1" : "1"}
                                  min={option.min}
                                  max={option.max}
                                />
                                {key === "api_key" && (
                                  <div className="absolute right-0 top-0 h-full flex items-center pr-2">
                                    {GET_KEY_LINKS[selectedProvider] && (
                                      <a
                                        href={GET_KEY_LINKS[selectedProvider]}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:text-primary/80"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive" className="py-1.5 px-2">
              <AlertDescription className="text-[10px]">{error}</AlertDescription>
            </Alert>
          )}

          {/* Save Button */}
          <Button onClick={handleSave} disabled={!isValid} className="w-full h-8 text-xs font-medium">
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
      size="icon"
      onClick={onClick}
      className={cn(
        "fixed bottom-4 left-4 z-40 rounded-full h-10 w-10 shadow-lg border-border bg-background/80 backdrop-blur-sm hover:bg-accent transition-all",
        isConfigured ? "border-green-500/50" : "border-border"
      )}
    >
      <Settings className={cn(
        "h-5 w-5",
        isConfigured ? "text-green-500" : "text-muted-foreground"
      )} />
    </Button>
  );
}
