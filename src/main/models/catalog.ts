// The models a key can be used with, read from its vendor -- what a person picks from under
// Models, and the connection test as well: a key that lists models is a key that works.
// Two vendors need more than a GET, for the reasons Slipwright found against their live
// APIs and wrote down in slipwright/providers/openrouter.py and evren.py:
//
//   OpenRouter answers /models to anybody, key or none, so the key is proved on /key first;
//   and a model there that cannot answer in JSON answers in prose instead of failing, so
//   only those listing `response_format` are offered.
//
//   EVREN lists OCR, embedding and speech models beside the chat ones, and says which is
//   which, so only a chat model that answers in JSON is offered. It refuses everything,
//   the list included, until a person accepts its terms for the key -- which this app
//   never does on its own: the page shows EVREN's text and the person presses the button.

import type { EvrenTerms, ModelList, ProviderId } from "@shared/types";
import { VENDORS, isKeyVendor, type KeyVendor } from "@shared/vendors";

/** What Claude Code takes for `--model` without anyone having to look it up. */
const CLAUDE_CODE_MODELS = ["sonnet", "opus", "haiku"];
/** OpenAI's list is every model it has ever made; these are not ones a phase is written with. */
const NOT_CHAT = /embedding|whisper|tts|dall-e|moderation|davinci|babbage|audio|realtime|transcribe|image|search|computer-use/i;

const base = (vendor: KeyVendor, baseUrl: string | null) => (baseUrl || VENDORS[vendor].baseUrl).replace(/\/+$/, "");

async function get(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(url, { headers: { "user-agent": "slipwright-agent", ...headers }, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: the status says enough
  }
  return { status: response.status, body, text };
}

function errorOf(body: unknown, text: string): string {
  const err = (body as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return text.slice(0, 200);
}

const termsRefused = (body: unknown, text: string) => /terms_not_accepted/.test(text) || ((body as { error?: { code?: string } })?.error?.code ?? "") === "terms_not_accepted";

// model id -> takes reasoning_effort, per EVREN host and key; read with the list
const evrenEffort = new Map<string, { at: number; effort: Record<string, boolean> }>();
const EFFORT_TTL_MS = 10 * 60_000;

export async function listModels(provider: ProviderId, key: string | null, baseUrl: string | null): Promise<ModelList> {
  if (provider === "claude-code") return { ok: true, models: CLAUDE_CODE_MODELS, message: "" };
  // Codex takes whatever the ChatGPT plan offers that day; it has no list to ask
  if (provider === "codex") return { ok: true, models: [], message: "" };
  if (!isKeyVendor(provider)) return { ok: false, models: [], message: "unknown provider" };
  if (!key) return { ok: false, models: [], message: "no key" };
  const spec = VENDORS[provider];
  const url = base(provider, baseUrl);
  try {
    if (provider === "anthropic") {
      const r = await get(`${url}/models?limit=1000`, { "x-api-key": key, "anthropic-version": "2023-06-01" });
      if (r.status >= 400) return { ok: false, models: [], message: `${spec.label} ${r.status}: ${errorOf(r.body, r.text)}` };
      return done(ids(r.body));
    }
    const auth = { authorization: `Bearer ${key}` };
    if (provider === "openrouter") {
      const proof = await get(`${url}/key`, auth);
      if (proof.status >= 400) return { ok: false, models: [], message: `OpenRouter rejected the key (${proof.status})` };
    }
    const r = await get(`${url}/models`, auth);
    if (provider === "evren" && termsRefused(r.body, r.text)) {
      return { ok: false, models: [], terms: true, message: "EVREN's terms of use have not been accepted for this key" };
    }
    if (r.status >= 400) return { ok: false, models: [], message: `${spec.label} ${r.status}: ${errorOf(r.body, r.text)}` };
    const data = entries(r.body);
    if (provider === "openrouter") return done(data.filter((m) => (m.supported_parameters as string[] | undefined)?.includes("response_format")).map((m) => String(m.id)));
    if (provider === "evren") {
      rememberEvren(url, key, data);
      return done(data.filter(evrenUsable).map((m) => String(m.id)));
    }
    const all = data.map((m) => String(m.id));
    return done(provider === "openai" ? all.filter((id) => !NOT_CHAT.test(id)) : all);
  } catch (error) {
    return { ok: false, models: [], message: `could not reach ${spec.label}: ${(error as Error).message}` };
  }
}

function entries(body: unknown): Record<string, unknown>[] {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data.filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && "id" in m) : [];
}

function ids(body: unknown): string[] {
  return entries(body).map((m) => String(m.id));
}

function done(models: string[]): ModelList {
  const sorted = [...new Set(models)].sort();
  return { ok: true, models: sorted, message: sorted.length ? `${sorted.length} models` : "the key works, but no model was listed" };
}

function evrenUsable(m: Record<string, unknown>): boolean {
  const caps = (m.capabilities ?? {}) as Record<string, unknown>;
  return (m.task === "chat" || m.task === "vision_chat") && !!caps.response_format;
}

function rememberEvren(url: string, key: string, data: Record<string, unknown>[]): void {
  const effort: Record<string, boolean> = {};
  for (const m of data) effort[String(m.id)] = !!((m.capabilities ?? {}) as Record<string, unknown>).reasoning_effort;
  evrenEffort.set(`${url}|${key}`, { at: Date.now(), effort });
}

/** Whether an EVREN model takes `reasoning_effort`. Unknown means no: a request without it
 *  is answered, one with it can be refused outright. */
export async function evrenTakesEffort(url: string, key: string, model: string): Promise<boolean> {
  const seen = evrenEffort.get(`${url}|${key}`);
  if (!seen || (!(model in seen.effort) && Date.now() - seen.at > EFFORT_TTL_MS)) {
    try {
      const r = await get(`${url}/models`, { authorization: `Bearer ${key}` });
      if (r.status < 400) rememberEvren(url, key, entries(r.body));
    } catch {
      // a catalogue that cannot be read costs the call its thinking depth, not the call
    }
  }
  return !!evrenEffort.get(`${url}|${key}`)?.effort[model];
}

export async function evrenTerms(key: string | null, baseUrl: string | null): Promise<EvrenTerms> {
  if (!key) return { ok: false, version: 0, accepted: false, text: "", message: "no key" };
  const url = base("evren", baseUrl);
  const auth = { authorization: `Bearer ${key}` };
  try {
    const status = await get(`${url}/terms/status`, auth);
    if (status.status >= 400) return { ok: false, version: 0, accepted: false, text: "", message: `EVREN ${status.status}: ${errorOf(status.body, status.text)}` };
    const text = await get(`${url}/terms/text`, auth);
    const s = (status.body ?? {}) as { current_version?: number; accepted?: boolean };
    return {
      ok: true,
      version: Number(s.current_version ?? 0),
      accepted: !!s.accepted,
      text: String(((text.body ?? {}) as { content?: string }).content ?? ""),
      message: "",
    };
  } catch (error) {
    return { ok: false, version: 0, accepted: false, text: "", message: `could not reach EVREN: ${(error as Error).message}` };
  }
}

/** Accepts the version the person was shown -- never whatever is current: one published
 *  between reading and pressing is refused, not signed unread. */
export async function acceptEvrenTerms(key: string | null, baseUrl: string | null, version: number): Promise<EvrenTerms> {
  if (!key) return { ok: false, version: 0, accepted: false, text: "", message: "no key" };
  const url = base("evren", baseUrl);
  try {
    const r = await fetch(`${url}/terms/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "user-agent": "slipwright-agent" },
      body: JSON.stringify({ version }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      const text = await r.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON
      }
      return { ok: false, version, accepted: false, text: "", message: `EVREN did not accept it: ${errorOf(body, text)}` };
    }
  } catch (error) {
    return { ok: false, version, accepted: false, text: "", message: `could not reach EVREN: ${(error as Error).message}` };
  }
  return evrenTerms(key, baseUrl);
}
