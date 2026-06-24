export const OPENAI_CHAT_MODELS = [
  { id: "gpt-5-mini-2025-08-07", label: "GPT-5 mini", provider: "openai" },
  { id: "gpt-5-nano", label: "GPT-5 nano", provider: "openai" },
] as const;

export const DEEPSEEK_CHAT_MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek" },
] as const;

export const CHAT_MODELS = [...OPENAI_CHAT_MODELS, ...DEEPSEEK_CHAT_MODELS] as const;

export type OpenAIChatModel = (typeof OPENAI_CHAT_MODELS)[number]["id"];
export type DeepSeekChatModel = (typeof DEEPSEEK_CHAT_MODELS)[number]["id"];
export type ChatModel = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_CHAT_MODEL: ChatModel = "deepseek-v4-flash";
export const LEGACY_DEFAULT_CHAT_MODEL: ChatModel = "gpt-5-mini-2025-08-07";

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

export function normalizeChatModel(value: string | undefined): ChatModel {
  const candidate = (value ?? "").trim();
  return isChatModel(candidate) ? candidate : DEFAULT_CHAT_MODEL;
}

export function normalizeStoredChatModel(value: string | undefined): ChatModel {
  const normalized = normalizeChatModel(value);
  return normalized === LEGACY_DEFAULT_CHAT_MODEL ? DEFAULT_CHAT_MODEL : normalized;
}
