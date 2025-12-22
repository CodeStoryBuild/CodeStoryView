export const PROVIDER_MODELS: Record<string, string[]> = {
  azure: [
    "gpt-5.2",
    "gpt-5-mini",
    "gpt-5-pro",
    "gpt-4.1-turbo",
    "o3-pro",
    "o3-mini",
    "o1",
  ],
  fireworks: [
    "qwen3-coder-480b-instruct",
    "llama-3.3-70b-versatile",
    "glm-4.6",
    "kimi-k2-instruct",
    "deepseek-v3",
    "gpt-oss-120b",
  ],
  openai: [
    "gpt-5.2",
    "gpt-5-mini",
    "gpt-5-nano",
    "o3-pro",
    "o3-mini",
    "o3-deep-research",
    "gpt-4.1",
    "gpt-4o",
  ],
  inception: ["inception-v3"],
  cohere: [
    "command-r-08-2024",
    "command-r-plus-08-2024",
    "command-nightly",
    "embed-english-v3.0",
  ],
  mistral: [
    "pixtral-large-latest",
    "mistral-large-2411",
    "mistral-small-2409",
    "codestral-22b",
    "ministral-8b",
  ],
  deepseek: [
    "deepseek-v3",
    "deepseek-r1",
    "deepseek-v3.2-speciale",
    "deepseek-vl2",
    "deepseek-chat",
  ],
  aws: [
    "amazon-nova-2-pro",
    "amazon-nova-2-lite",
    "claude-4.5-sonnet",
    "claude-3.5-opus",
    "mistral-large-2",
  ],
  huggingface: [
    "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/Llama-3.1-405B",
    "qwen/Qwen3-235B",
    "deepseek-ai/DeepSeek-V3",
  ],
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "whisper-large-v3-turbo",
    "qwen/qwen3-32b",
    "gpt-oss-120b",
  ],
  together: [
    "llama-3.3-70b-instruct",
    "qwen3-235b-instruct",
    "deepseek-v3.1",
    "gpt-oss-120b",
    "glm-4.6",
    "kimi-k2-thinking",
  ],
  googlegenai: [
    "gemini-3-pro",
    "gemini-3-flash",
    "gemini-3-deep-think",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
  ],
  anthropic: [
    "claude-4.5-sonnet",
    "claude-3.7-sonnet",
    "claude-3.5-opus",
    "claude-3.5-haiku",
  ],
  lmstudio: [],
  cerebras: [
    "llama-3.3-70b",
    "llama3.1-8b",
    "zai-glm-4.6",
    "qwen3-32b",
    "gpt-oss-120b",
    "qwen-3-235b-a22b-instruct-2507",
  ],
  ollama: ["llama3.3", "deepseek-v3", "qwen3", "phi4", "mistral-nemo"],
  sambanova: [
    "llama-3.3-70b-instruct",
    "deepseek-r1",
    "deepseek-v3.1",
    "qwen3-32b",
    "gpt-oss-120b",
  ],
  watsonx: [
    "granite-3.0-30b-instruct",
    "granite-3.0-8b-instruct",
    "granite-20b-code-instruct",
    "llama-3.3-70b",
  ],
  nebius: ["llama-3.3-70b-instruct", "deepseek-v3", "qwen2.5-72b-instruct"],
  xai: ["grok-4.1", "grok-4.1-thinking", "grok-4.1-fast"],
  openrouter: [],
  centml: [],
  featherless: [],
};

export const GET_KEY_LINKS: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys/",
  deepseek: "https://platform.deepseek.com/api_keys",
  together: "https://api.together.xyz/settings/api-keys",
  fireworks: "https://fireworks.ai/account/api-keys",
  cohere: "https://dashboard.cohere.com/api-keys",
};

export type ConfigOptionType = "string" | "number" | "boolean" | "literal";

export interface ConfigOption {
  type: ConfigOptionType;
  allowed?: string[];
  description: string;
  min?: number;
  max?: number;
  is_int?: boolean;
}

export const GLOBAL_OPTIONS: Record<string, ConfigOption> = {
  api_base: {
    type: "string",
    description: "Custom API base URL for the LLM provider (optional)",
  },
  temperature: {
    type: "number",
    description: "Temperature for LLM responses (0.0-1.0)",
    min: 0.0,
    max: 1.0,
  },
  max_tokens: {
    type: "number",
    description: "Maximum tokens to send for LLM requests",
    min: 1,
    is_int: true,
  },
  relevance_filter_level: {
    type: "literal",
    description: "How much to filter for irrelevant changes",
    allowed: ["safe", "standard", "strict"],
  },
  secret_scanner_aggression: {
    type: "literal",
    description: "How aggresively to scan for secrets ('cst commit' only)",
    allowed: ["safe", "standard", "strict"],
  },
  fallback_grouping_strategy: {
    type: "literal",
    description:
      "Strategy for grouping changes that were not able to be analyzed",
    allowed: [
      "all_together",
      "by_file_path",
      "by_file_name",
      "by_file_extension",
      "all_alone",
    ],
  },
  chunking_level: {
    type: "literal",
    description:
      "Which type of changes should be chunked further into smaller pieces",
    allowed: ["none", "full_files", "all_files"],
  },
  verbose: { type: "boolean", description: "Enable verbose logging output" },
  auto_accept: {
    type: "boolean",
    description: "Automatically accept all prompts without user confirmation",
  },
  silent: {
    type: "boolean",
    description:
      "Do not output any text to the console, except for prompting acceptance",
  },
  ask_for_commit_message: {
    type: "boolean",
    description:
      "Allow asking you to provide commit messages to optionally override the auto generated ones",
  },
  display_diff_type: {
    type: "literal",
    description: "Type of diff to display when showing diffs (semantic or git)",
    allowed: ["semantic", "git"],
  },
  custom_language_config: {
    type: "string",
    description: "Path to custom language configuration JSON file",
  },
  batching_strategy: {
    type: "literal",
    description: "Strategy for batching LLM requests (auto, requests, prompt)",
    allowed: ["auto", "requests", "prompt"],
  },
  custom_embedding_model: {
    type: "string",
    description: "FastEmbed supported text embedding model",
  },
  cluster_strictness: {
    type: "number",
    description: "Strictness of clustering logical groups together (0-1)",
    min: 0.0,
    max: 1.0,
  },
  num_retries: {
    type: "number",
    description: "How many times to retry calling a model if it fails (0-10)",
    min: 0,
    max: 10,
    is_int: true,
  },
};
