import { afterEach, describe, expect, it, vi } from "vitest";
import { callCompat } from "../src/main/models/api";
import { listModels } from "../src/main/models/catalog";
import type { ModelCall } from "../src/main/models/types";
import { resolveChoice } from "../src/shared/resolve";
import type { AgentSettings, Settings } from "../src/shared/types";

type Seen = { url: string; init?: RequestInit };

function answering(routes: Record<string, { status?: number; body: unknown }>): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    const { status = 200, body } = hit?.[1] ?? { status: 404, body: { error: { message: "no route" } } };
    return new Response(JSON.stringify(body), { status });
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

const call = (over: Partial<ModelCall> = {}): ModelCall => ({
  system: "be brief",
  prompt: "say {}",
  images: [],
  thinkingDepth: null,
  model: "",
  checkout: null,
  scratch: ".",
  timeoutMs: 10_000,
  signal: new AbortController().signal,
  log: () => undefined,
  ...over,
});

describe("the models a key can be used with", () => {
  it("are OpenRouter's that answer in JSON, once the key is proved -- its list answers anybody", async () => {
    const seen = answering({
      "/key": { body: { data: {} } },
      "/models": { body: { data: [{ id: "a/json", supported_parameters: ["response_format"] }, { id: "b/prose", supported_parameters: [] }] } },
    });
    const got = await listModels("openrouter", "sk-or-1", null);
    expect(got.models).toEqual(["a/json"]);
    expect(seen[0]?.url).toBe("https://openrouter.ai/api/v1/key");
  });

  it("are not OpenRouter's at all when the key is refused", async () => {
    answering({ "/key": { status: 401, body: {} }, "/models": { body: { data: [{ id: "a", supported_parameters: ["response_format"] }] } } });
    const got = await listModels("openrouter", "wrong", null);
    expect(got.ok).toBe(false);
    expect(got.models).toEqual([]);
  });

  it("are EVREN's chat models that answer in JSON, never its OCR or embedding ones", async () => {
    answering({
      "/models": {
        body: {
          data: [
            { id: "glm-5.3", task: "chat", capabilities: { response_format: true, reasoning_effort: true } },
            { id: "qwen3-vl", task: "vision_chat", capabilities: { response_format: true } },
            { id: "ocr-1", task: "ocr", capabilities: {} },
            { id: "gemma-4", task: "chat", capabilities: { response_format: false } },
          ],
        },
      },
    });
    expect((await listModels("evren", "evren_llm_1", null)).models).toEqual(["glm-5.3", "qwen3-vl"]);
  });

  it("say so when EVREN's terms are not accepted, rather than 'error 403'", async () => {
    answering({ "/models": { status: 403, body: { error: { code: "terms_not_accepted", message: "accept" } } } });
    const got = await listModels("evren", "evren_llm_1", null);
    expect(got.terms).toBe(true);
  });

  it("are read from the host a person put in place of the vendor's", async () => {
    const seen = answering({ "/models": { body: { data: [{ id: "deepseek-chat" }] } } });
    await listModels("deepseek", "sk-1", "https://proxy.example/v1/");
    expect(seen[0]?.url).toBe("https://proxy.example/v1/models");
  });
});

describe("a call to a vendor speaking OpenAI's protocol", () => {
  it("goes to its own host, with its own limit and the key in the header", async () => {
    const seen = answering({ "/chat/completions": { body: { model: "deepseek-chat", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } } } });
    const answer = await callCompat(call({ model: "deepseek-chat" }), "sk-ds", "deepseek", { baseUrl: null, maxTokens: null });
    expect(answer.text).toBe("{}");
    expect(seen[0]?.url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(seen[0]?.init?.body));
    expect(body.max_tokens).toBe(32_000);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect((seen[0]?.init?.headers as Record<string, string>).authorization).toBe("Bearer sk-ds");
  });

  it("is refused here, not at the vendor, when no model is chosen for it", async () => {
    answering({});
    await expect(callCompat(call(), "sk-ds", "deepseek")).rejects.toThrow(/choose one under Models/);
  });

  it("sends a thinking depth only to a vendor that takes one, and OpenAI's limit by its own name", async () => {
    const seen = answering({ "/chat/completions": { body: { choices: [{ message: { content: "{}" } }] } } });
    await callCompat(call({ model: "gpt-5", thinkingDepth: "max" }), "sk", "openai");
    await callCompat(call({ model: "glm-4.6", thinkingDepth: "max" }), "k", "glm");
    const [openai, glm] = seen.map((s) => JSON.parse(String(s.init?.body)));
    expect(openai.reasoning_effort).toBe("high");
    expect(openai.max_completion_tokens).toBe(32_000);
    expect(glm.reasoning_effort).toBeUndefined();
  });
});

describe("which provider an agent writes with", () => {
  const agents = (backend: AgentSettings["model"]) =>
    ({ backend: { enabled: true, model: backend }, web: { enabled: true, model: null }, mobile: { enabled: true, model: null }, devops: { enabled: false, model: null } }) as Settings["agents"];
  const providers = { evren: { model: "glm-5.3", baseUrl: null, maxTokens: null }, deepseek: { model: "deepseek-chat", baseUrl: "https://p/v1", maxTokens: 9000 } };

  it("is the default provider, on its default model, when it is not pinned", () => {
    expect(resolveChoice({ agents: agents(null), defaultProvider: "evren", providers }, "web")).toEqual({ provider: "evren", model: "glm-5.3", baseUrl: null, maxTokens: null });
  });

  it("is its own when pinned, on that provider's default model unless it names one", () => {
    expect(resolveChoice({ agents: agents({ provider: "deepseek", model: "" }), defaultProvider: "evren", providers }, "backend")).toEqual({ provider: "deepseek", model: "deepseek-chat", baseUrl: "https://p/v1", maxTokens: 9000 });
    expect(resolveChoice({ agents: agents({ provider: "deepseek", model: "deepseek-reasoner" }), defaultProvider: "evren", providers }, "backend")?.model).toBe("deepseek-reasoner");
  });

  it("is none when nothing is pinned and no provider is the default", () => {
    expect(resolveChoice({ agents: agents(null), defaultProvider: null, providers }, "web")).toBeNull();
  });
});
