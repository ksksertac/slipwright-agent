// Every model vendor a key can be given for, as Slipwright's own Models page lists them
// (slipwright/providers/registry.py). The app used to know two -- Anthropic and OpenAI --
// so a person who wrote phases on DeepSeek, Gemini or EVREN on the server could not lend a
// machine that did the same. One table now, read by the page, the worker and the
// headless CLI alike, with the same hosts, limits and quirks as the server's.
//
// Seven of the nine speak OpenAI's chat-completions protocol on their own host, so one
// client serves them (src/main/models/api.ts); Anthropic has its own.

export const KEY_VENDORS = ["anthropic", "openai", "deepseek", "gemini", "qwen", "glm", "minimax", "openrouter", "evren"] as const;
export type KeyVendor = (typeof KEY_VENDORS)[number];

export interface VendorSpec {
  id: KeyVendor;
  label: string;
  /** Two letters for the square beside its name. */
  mark: string;
  /** Where its key is read from on a server with no window (slipwright-agent). */
  env: string;
  baseUrl: string;
  /** Where a person gets a key. */
  keysUrl: string;
  placeholder: string;
  /** Whether a thinking depth is sent as `reasoning_effort` (OpenAI's word for it). */
  effort: boolean;
  /** The largest answer it takes in one call, and what the parameter is called. */
  maxTokens: number;
  maxTokensParam: "max_tokens" | "max_completion_tokens";
}

const v = (spec: Omit<VendorSpec, "maxTokens" | "maxTokensParam" | "effort"> & Partial<VendorSpec>): VendorSpec => ({
  effort: false,
  maxTokens: 32_000,
  maxTokensParam: "max_tokens",
  ...spec,
});

export const VENDORS: Record<KeyVendor, VendorSpec> = {
  anthropic: v({ id: "anthropic", label: "Anthropic (Claude)", mark: "A", env: "ANTHROPIC_API_KEY", baseUrl: "https://api.anthropic.com/v1", keysUrl: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-…", effort: true, maxTokens: 64_000 }),
  openai: v({ id: "openai", label: "OpenAI (GPT)", mark: "O", env: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", keysUrl: "https://platform.openai.com/api-keys", placeholder: "sk-…", effort: true, maxTokensParam: "max_completion_tokens" }),
  deepseek: v({ id: "deepseek", label: "DeepSeek", mark: "DS", env: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com", keysUrl: "https://platform.deepseek.com/api_keys", placeholder: "sk-…" }),
  gemini: v({ id: "gemini", label: "Google (Gemini)", mark: "G", env: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keysUrl: "https://aistudio.google.com/apikey", placeholder: "AIza…", effort: true }),
  // 8k is what every Qwen and MiniMax model takes; more is refused outright by some
  qwen: v({ id: "qwen", label: "Alibaba (Qwen)", mark: "Q", env: "DASHSCOPE_API_KEY", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keysUrl: "https://bailian.console.alibabacloud.com/?tab=model#/api-key", placeholder: "sk-…", maxTokens: 8_192 }),
  glm: v({ id: "glm", label: "Z.ai (GLM)", mark: "Z", env: "ZHIPUAI_API_KEY", baseUrl: "https://api.z.ai/api/paas/v4", keysUrl: "https://z.ai/manage-apikey/apikey-list", placeholder: "…" }),
  minimax: v({ id: "minimax", label: "MiniMax", mark: "MM", env: "MINIMAX_API_KEY", baseUrl: "https://api.minimax.io/v1", keysUrl: "https://www.minimax.io/platform/user-center/basic-information/interface-key", placeholder: "…", maxTokens: 8_192 }),
  openrouter: v({ id: "openrouter", label: "OpenRouter", mark: "OR", env: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", keysUrl: "https://openrouter.ai/settings/keys", placeholder: "sk-or-…", effort: true }),
  // reasoning effort is per model at EVREN (Gemma refuses it, GLM takes it): the catalogue
  // says which, so `effort` here only means "ask the catalogue"
  evren: v({ id: "evren", label: "EVREN (SSB)", mark: "EV", env: "EVREN_API_KEY", baseUrl: "https://evren-llmapi.ssyz.org.tr/v1", keysUrl: "https://evren.ssyz.org.tr/api-keys", placeholder: "evren_llm_…", effort: true }),
};

export function isKeyVendor(id: string): id is KeyVendor {
  return (KEY_VENDORS as readonly string[]).includes(id);
}
