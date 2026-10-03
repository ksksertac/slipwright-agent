// Which provider and model an agent writes with, decided in one place for the page, the
// worker and the headless CLI. As on Slipwright's own Models page: one provider is the
// default, and an agent that names no provider of its own writes with it; a provider named
// without a model uses the default model set for that provider.

import type { AgentId, ProviderId, ResolvedChoice, Settings } from "./types";
import { KEY_VENDORS, VENDORS } from "./vendors";

export const PROVIDER_IDS: ProviderId[] = ["claude-code", "codex", ...KEY_VENDORS];

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  "claude-code": "Claude Code",
  codex: "ChatGPT subscription (Codex)",
  ...(Object.fromEntries(KEY_VENDORS.map((id) => [id, VENDORS[id].label])) as Record<(typeof KEY_VENDORS)[number], string>),
};

export function resolveChoice(settings: Pick<Settings, "agents" | "defaultProvider" | "providers">, agent: AgentId): ResolvedChoice | null {
  const own = settings.agents[agent].model;
  const provider = own?.provider ?? settings.defaultProvider;
  if (!provider) return null;
  const p = settings.providers?.[provider];
  return { provider, model: own?.model || p?.model || "", baseUrl: p?.baseUrl || null, maxTokens: p?.maxTokens ?? null };
}
