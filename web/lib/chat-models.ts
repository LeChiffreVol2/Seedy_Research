export const OPENAI_CHAT_MODELS = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", credits: 1, requiresPro: false },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai", credits: 5, requiresPro: true },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", credits: 10, requiresPro: true },
] as const;

export const DEEPSEEK_CHAT_MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek", credits: 1, requiresPro: false },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek", credits: 2, requiresPro: true },
] as const;

export const CHAT_MODELS = [
  DEEPSEEK_CHAT_MODELS[0],
  OPENAI_CHAT_MODELS[0],
  DEEPSEEK_CHAT_MODELS[1],
  OPENAI_CHAT_MODELS[1],
  OPENAI_CHAT_MODELS[2],
] as const;

export type OpenAIChatModel = (typeof OPENAI_CHAT_MODELS)[number]["id"];
export type DeepSeekChatModel = (typeof DEEPSEEK_CHAT_MODELS)[number]["id"];
export type ChatModel = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_CHAT_MODEL: ChatModel = "deepseek-v4-flash";

const LEGACY_CHAT_MODEL_IDS = new Set(["gpt-5-mini-2025-08-07", "gpt-5-nano"]);

const CHAT_MODEL_IDS = new Set<string>(CHAT_MODELS.map((model) => model.id));
const OPENAI_MODEL_IDS = new Set<string>(OPENAI_CHAT_MODELS.map((model) => model.id));
const DEEPSEEK_MODEL_IDS = new Set<string>(DEEPSEEK_CHAT_MODELS.map((model) => model.id));

export function isChatModel(value: string): value is ChatModel {
  return CHAT_MODEL_IDS.has(value);
}

export function isOpenAIChatModel(value: string): value is OpenAIChatModel {
  return OPENAI_MODEL_IDS.has(value);
}

export function isDeepSeekChatModel(value: string): value is DeepSeekChatModel {
  return DEEPSEEK_MODEL_IDS.has(value);
}

export function chatModelCredits(value: ChatModel): number {
  return CHAT_MODELS.find((model) => model.id === value)?.credits ?? 1;
}

export function chatModelRequiresPro(value: ChatModel): boolean {
  return CHAT_MODELS.find((model) => model.id === value)?.requiresPro ?? false;
}

export function normalizeChatModel(value: string | undefined): ChatModel {
  const candidate = (value ?? "").trim();
  return isChatModel(candidate) ? candidate : DEFAULT_CHAT_MODEL;
}

export function normalizeStoredChatModel(value: string | undefined): ChatModel {
  const candidate = (value ?? "").trim();
  return LEGACY_CHAT_MODEL_IDS.has(candidate) ? DEFAULT_CHAT_MODEL : normalizeChatModel(candidate);
}
