// A person's own API key, for any vendor Slipwright's Models page lists (shared/vendors.ts),
// called straight from this machine. Plain fetch rather than an SDK: Anthropic has one
// request shape, the other eight share OpenAI's, and the app stays free of large
// dependencies for it. The key never leaves the main process except in the request header
// to its own vendor.

import { VENDORS, type KeyVendor } from "@shared/vendors";
import { evrenTakesEffort } from "./catalog";
import { Cancelled, ModelFailure, type ModelAnswer, type ModelCall } from "./types";

/** Where and how much: the vendor's own host and limit unless Models says otherwise. */
export interface CallOptions {
  baseUrl: string | null;
  maxTokens: number | null;
}

export function baseOf(vendor: KeyVendor, baseUrl: string | null): string {
  return (baseUrl || VENDORS[vendor].baseUrl).replace(/\/+$/, "");
}

export const ANTHROPIC_DEFAULT = "claude-sonnet-5-5";
export const OPENAI_DEFAULT = "gpt-5";

const EFFORT: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "max" };
// OpenAI's word has no "max": the deepest it offers is "high"
const OPENAI_EFFORT: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "high" };

function failure(status: number, body: string, vendor: string): ModelFailure {
  let message = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message ?? message;
  } catch {
    // not JSON
  }
  // a key that is wrong, out of credit or over its limit will be the same on a retry
  const kind = status === 401 || status === 403 || status === 429 || status === 402 ? "rejected" : "error";
  return new ModelFailure(`${vendor} ${status}: ${message}`, kind);
}

function signals(call: ModelCall): AbortSignal {
  return AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs)]);
}

function aborted(call: ModelCall, error: unknown): Error {
  if (call.signal.aborted) return new Cancelled("taken back");
  if ((error as Error)?.name === "TimeoutError") return new ModelFailure("the API call timed out", "timeout");
  return new ModelFailure(`could not reach the API: ${(error as Error)?.message ?? error}`, "error");
}

export interface SseState {
  text: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
  error: string | null;
}

/** Folds Anthropic's stream events into the answer. Streamed because a phase can be long:
 *  a non-streamed request with a large max_tokens risks the connection timing out first. */
export function foldAnthropicEvent(state: SseState, event: Record<string, unknown>): void {
  switch (event.type) {
    case "message_start": {
      const message = (event.message ?? {}) as { model?: string; usage?: Record<string, number> };
      state.model = message.model ?? state.model;
      const u = message.usage ?? {};
      state.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      break;
    }
    case "content_block_delta": {
      const delta = (event.delta ?? {}) as { type?: string; text?: string };
      if (delta.type === "text_delta" && delta.text) state.text += delta.text;
      break;
    }
    case "message_delta": {
      const usage = (event.usage ?? {}) as { output_tokens?: number };
      const delta = (event.delta ?? {}) as { stop_reason?: string };
      if (usage.output_tokens != null) state.outputTokens = usage.output_tokens;
      if (delta.stop_reason) state.stopReason = delta.stop_reason;
      break;
    }
    case "error": {
      const error = (event.error ?? {}) as { type?: string; message?: string };
      state.error = `${error.type ?? "error"}: ${error.message ?? ""}`;
      break;
    }
  }
}

/** Splits an SSE body into the JSON of each `data:` line. */
export function* sseData(text: string): Generator<Record<string, unknown>> {
  for (const block of text.split(/\r?\n\r?\n/)) {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // half an event: the caller only passes whole blocks
      }
    }
  }
}

export async function callAnthropic(call: ModelCall, key: string, options: CallOptions = { baseUrl: null, maxTokens: null }): Promise<ModelAnswer> {
  const model = call.model || ANTHROPIC_DEFAULT;
  const content: unknown[] = call.images.map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.media_type, data: image.data },
  }));
  const labels = call.images.map((image, n) => (image.label ? `Image ${n + 1}: ${image.label}` : null)).filter(Boolean);
  content.push({ type: "text", text: (labels.length ? labels.join("\n") + "\n\n" : "") + call.prompt });
  const body: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? VENDORS.anthropic.maxTokens,
    stream: true,
    system: call.system,
    messages: [{ role: "user", content }],
  };
  const effort = call.thinkingDepth ? EFFORT[call.thinkingDepth] : undefined;
  if (effort) body.output_config = { effort };
  call.log(`Anthropic API · ${model}`);
  let response: Response;
  try {
    response = await fetch(`${baseOf("anthropic", options.baseUrl)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: signals(call),
    });
  } catch (error) {
    throw aborted(call, error);
  }
  if (!response.ok || !response.body) throw failure(response.status, await response.text(), "Anthropic");
  const state: SseState = { text: "", model, inputTokens: null, outputTokens: null, stopReason: null, error: null };
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true });
      const cut = pending.lastIndexOf("\n\n");
      if (cut < 0) continue;
      for (const event of sseData(pending.slice(0, cut))) foldAnthropicEvent(state, event);
      pending = pending.slice(cut + 2);
    }
    for (const event of sseData(pending)) foldAnthropicEvent(state, event);
  } catch (error) {
    throw aborted(call, error);
  }
  if (state.error) throw new ModelFailure(`Anthropic: ${state.error}`, /rate_limit|authentication|permission|billing/.test(state.error) ? "rejected" : "error");
  if (!state.text) throw new ModelFailure(`Anthropic gave no answer (${state.stopReason ?? "no stop reason"})`, "error");
  return { text: state.text, model: state.model, inputTokens: state.inputTokens, outputTokens: state.outputTokens };
}

/** One call to any vendor speaking OpenAI's chat-completions protocol: OpenAI itself,
 *  DeepSeek, Gemini, Qwen, GLM, MiniMax, OpenRouter and EVREN. */
export async function callCompat(call: ModelCall, key: string, vendor: Exclude<KeyVendor, "anthropic">, options: CallOptions = { baseUrl: null, maxTokens: null }): Promise<ModelAnswer> {
  const spec = VENDORS[vendor];
  const model = call.model || (vendor === "openai" ? OPENAI_DEFAULT : "");
  // the others have no model everyone has; a call with none would be refused by the vendor
  // in words that do not say where to choose one
  if (!model) throw new ModelFailure(`no model is chosen for ${spec.label}: choose one under Models`, "rejected");
  const base = baseOf(vendor, options.baseUrl);
  const content: unknown[] = [];
  for (const image of call.images) {
    if (image.label) content.push({ type: "text", text: image.label });
    content.push({ type: "image_url", image_url: { url: `data:${image.media_type};base64,${image.data}` } });
  }
  content.push({ type: "text", text: call.prompt });
  const body: Record<string, unknown> = {
    model,
    // json_object needs the word "JSON" somewhere in the messages; the server's
    // prompts always ask for one, and the system line says so regardless
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${call.system}\n\nAnswer with one JSON object.` },
      { role: "user", content: call.images.length ? content : call.prompt },
    ],
    [spec.maxTokensParam]: options.maxTokens ?? spec.maxTokens,
  };
  const effort = call.thinkingDepth ? OPENAI_EFFORT[call.thinkingDepth] : undefined;
  // EVREN takes it per model -- Gemma answers 400 to the body GLM accepts -- so its
  // catalogue decides; unknown means no, since a call without it is still answered
  if (effort && spec.effort && (vendor !== "evren" || (await evrenTakesEffort(base, key, model)))) body.reasoning_effort = effort;
  call.log(`${spec.label} · ${model}`);
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "user-agent": "slipwright-agent" },
      body: JSON.stringify(body),
      signal: signals(call),
    });
  } catch (error) {
    throw aborted(call, error);
  }
  const text = await response.text().catch((error) => {
    throw aborted(call, error);
  });
  if (!response.ok) {
    if (vendor === "evren" && /terms_not_accepted/.test(text)) {
      throw new ModelFailure("EVREN's terms of use have not been accepted for this key: accept them under Models → EVREN", "rejected");
    }
    throw failure(response.status, text, spec.label);
  }
  const parsed = JSON.parse(text) as {
    model?: string;
    choices?: { message?: { content?: string | { text?: string }[] }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = parsed.choices?.[0];
  const raw = choice?.message?.content ?? "";
  // some vendors answer in content parts rather than one string
  const answer = Array.isArray(raw) ? raw.map((part) => part.text ?? "").join("") : raw;
  if (choice?.finish_reason === "length") {
    throw new ModelFailure(`${spec.label} cut the answer off at ${options.maxTokens ?? spec.maxTokens} tokens: raise the limit under Models`, "error");
  }
  if (!answer) throw new ModelFailure(`${spec.label} gave no answer`, "error");
  return {
    text: answer,
    model: parsed.model ?? model,
    inputTokens: parsed.usage?.prompt_tokens ?? null,
    outputTokens: parsed.usage?.completion_tokens ?? null,
  };
}
