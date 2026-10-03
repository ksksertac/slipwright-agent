// Models: every provider Slipwright's own Models page lists, laid out the same way -- one
// card each, opened to its key, its host, the default model picked from what the key can
// see, and its answer limit -- and one provider marked default, which every agent that is
// not pinned to a provider of its own writes with.

import { useEffect, useRef, useState } from "react";
import { PROVIDER_IDS, PROVIDER_LABEL, resolveChoice } from "@shared/resolve";
import type { AgentId, AppState, EvrenTerms, ModelChoice, ModelList, ProviderId, Result } from "@shared/types";
import { AGENTS } from "@shared/types";
import { VENDORS, isKeyVendor } from "@shared/vendors";
import { t } from "./i18n";
import { AGENT_NAME, Head, Icon, Outcome, usable } from "./parts";

// what each provider's key can see, read once per page and again after a save or a test
const listed = new Map<ProviderId, ModelList>();

function useModels(provider: ProviderId | null, ready: boolean): [ModelList | null, () => Promise<ModelList | null>] {
  const [list, setList] = useState<ModelList | null>(provider ? (listed.get(provider) ?? null) : null);
  const load = async () => {
    if (!provider || !ready) return null;
    const got = await window.agent.listModels(provider, null, null);
    listed.set(provider, got);
    setList(got);
    return got;
  };
  useEffect(() => {
    setList(provider ? (listed.get(provider) ?? null) : null);
    if (provider && ready && !listed.has(provider)) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, ready]);
  return [list, load];
}

/** Whether a provider can be called at all here: a CLI that is installed, or a key kept. */
function present(state: AppState, provider: ProviderId): boolean {
  if (provider === "claude-code") return state.detected.claude.installed;
  if (provider === "codex") return state.detected.codex.installed;
  return !!state.secrets[provider];
}

/** A model picked from what the provider lists, or typed when it lists nothing (Codex,
 *  or a key that could not be read). The value the page holds is the model's id. */
function ModelSelect({ value, list, onChange, empty, label }: { value: string; list: ModelList | null; onChange: (model: string) => void; empty: string; label: string }) {
  const [typed, setTyped] = useState(value);
  useEffect(() => setTyped(value), [value]);
  const models = list?.models ?? [];
  if (!models.length) {
    return (
      <div className="input">
        <input aria-label={label} value={typed} placeholder={empty} onChange={(e) => setTyped(e.target.value)} onBlur={() => typed.trim() !== value && onChange(typed.trim())} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </div>
    );
  }
  // a model kept from before that the list no longer has stays visible, not silently lost
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return (
    <select className="select mono-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

// -- one provider ---------------------------------------------------------------------

function EvrenTermsLine() {
  const [terms, setTerms] = useState<EvrenTerms | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.agent.evrenTerms().then(setTerms);
  }, []);
  // with no key kept there is nothing to ask EVREN about yet
  if (!terms || terms.message === "no key") return null;
  if (!terms.ok) return <Outcome result={{ ok: false, message: terms.message }} />;
  if (terms.accepted) {
    return <Outcome result={{ ok: true, message: t("EVREN (SSB) terms of use (v{n}) are accepted for this key.", { n: terms.version }) }} />;
  }
  return (
    <div className="terms">
      <b>{t("EVREN refuses every call until its terms of use are accepted for this key. Read them first:")}</b>
      <pre>{terms.text}</pre>
      <div className="row-btns">
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const after = await window.agent.acceptEvrenTerms(terms.version);
            setBusy(false);
            setTerms(after);
            listed.delete("evren");
          }}
        >
          {t("I have read them and accept (v{n})", { n: terms.version })}
        </button>
      </div>
    </div>
  );
}

function ProviderCard({ state, provider, opened }: { state: AppState; provider: ProviderId; opened: boolean }) {
  const vendor = isKeyVendor(provider) ? VENDORS[provider] : null;
  const own = state.settings.providers[provider] ?? { model: "", baseUrl: null, maxTokens: null };
  const isDefault = state.settings.defaultProvider === provider;
  const there = present(state, provider);
  const [open, setOpen] = useState(opened);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (opened) card.current?.scrollIntoView({ block: "start" });
  }, [opened]);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(own.baseUrl ?? "");
  const [maxTokens, setMaxTokens] = useState(own.maxTokens ? String(own.maxTokens) : "");
  const [model, setModel] = useState(own.model);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, load] = useModels(open ? provider : null, there);
  useEffect(() => setModel(own.model), [own.model]);

  const test = async (typed: string | null) => {
    setBusy(true);
    const got = await window.agent.listModels(provider, typed, baseUrl.trim() || null);
    setBusy(false);
    if (got.ok && !typed) listed.set(provider, got);
    setResult({ ok: got.ok, message: got.ok ? t("Connection works: {n} models", { n: got.models.length }) : got.message });
    return got;
  };
  const save = async () => {
    setBusy(true);
    if (vendor && key.trim()) await window.agent.saveSecret(provider as keyof AppState["secrets"], key.trim());
    await window.agent.saveProvider(provider, { model, baseUrl: baseUrl.trim() || null, maxTokens: maxTokens ? Number(maxTokens) : null });
    setKey("");
    setBusy(false);
    // a new key, or a new host, sees a different list
    listed.delete(provider);
    const got = await load();
    setResult(got ? { ok: got.ok, message: got.ok ? t("Saved. {n} models listed.", { n: got.models.length }) : got.message } : { ok: true, message: t("Saved.") });
  };

  let status: React.ReactNode;
  if (vendor) {
    status = state.secrets[provider as keyof AppState["secrets"]] ? (
      <span className="pill inline p-idle">
        {Icon.check} {t("key set {hint}", { hint: state.secrets[provider as keyof AppState["secrets"]] ?? "" })}
      </span>
    ) : (
      <span className="pill inline p-off">{t("no key")}</span>
    );
  } else {
    const info = provider === "claude-code" ? state.detected.claude : state.detected.codex;
    status = <span className={`pill inline ${info.installed ? (info.signedIn === false ? "p-warn" : "p-idle") : "p-off"}`}>{info.installed ? (info.signedIn === false ? t("not signed in") : t("signed in")) : t("not found")}</span>;
  }
  const sub = own.model || (vendor ? (there ? t("choose a default model") : t("add a key to use it")) : t("the CLI's own default"));

  return (
    <div ref={card} className={`pcard${open ? " open" : ""}`}>
      <button className="phead" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev">{open ? "⌄" : "›"}</span>
        <span className="pname">
          <b>
            {t(PROVIDER_LABEL[provider])}
            {isDefault && <span className="tag">{t("default")}</span>}
          </b>
          <small className={own.model ? "mono" : ""}>{sub}</small>
        </span>
        {status}
      </button>
      {open && (
        <div className="pbody">
          {provider === "evren" && there && <EvrenTermsLine />}
          {!vendor && !there && (
            <p className="hint">
              {t("Install with")}: <span className="mono">{provider === "claude-code" ? "npm install -g @anthropic-ai/claude-code" : "npm install -g @openai/codex"}</span>
            </p>
          )}
          <div className={vendor ? "pgrid" : "pgrid one"}>
            {vendor && (
              <div className="field">
                <label>{t("API key")}</label>
                <div className="input">
                  <input type="password" value={key} placeholder={state.secrets[vendor.id] ? t("kept, ends {hint}", { hint: state.secrets[vendor.id] ?? "" }) : vendor.placeholder} onChange={(e) => setKey(e.target.value)} />
                </div>
                <p className="hint">
                  {t("Get one at")}{" "}
                  <a href={vendor.keysUrl} target="_blank" rel="noreferrer">
                    {vendor.keysUrl.replace(/^https:\/\//, "").split(/[/?#]/)[0]}
                  </a>
                  ; {t("on a server, set")} <span className="mono">{vendor.env}</span>.
                </p>
              </div>
            )}
            {vendor && (
              <div className="field">
                <label>{t("Base URL (optional)")}</label>
                <div className="input">
                  <input value={baseUrl} placeholder={vendor.baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                </div>
                <p className="hint">{t("Leave empty for {url}; fill it in to go through a proxy.", { url: vendor.baseUrl })}</p>
              </div>
            )}
            <div className="field">
              <label>{t("Default model")}</label>
              <ModelSelect value={model} list={list} onChange={setModel} label={t("Default model")} empty={vendor ? (list?.models.length ? t("— choose —") : t("model name")) : t("the CLI's own default")} />
              <p className="hint">{t("With this provider as the default, every agent not pinned to a provider uses this model.")}</p>
            </div>
            {vendor && (
              <div className="field">
                <label>{t("Most output tokens per call")}</label>
                <div className="input">
                  <input inputMode="numeric" value={maxTokens} placeholder={t("{n} (the provider's usual)", { n: vendor.maxTokens })} onChange={(e) => setMaxTokens(e.target.value.replace(/\D/g, ""))} />
                </div>
                <p className="hint">{t("How long one answer may be. Raise it if the provider's newer models allow more.")}</p>
              </div>
            )}
          </div>
          <div className="row-btns">
            <button className="btn primary" disabled={busy} onClick={() => void save()}>
              {t("Save")}
            </button>
            {vendor && (
              <button className="btn" disabled={busy || (!key.trim() && !there)} onClick={() => void test(key.trim() || null)}>
                {t("Test connection")}
              </button>
            )}
            <button className="btn" disabled={isDefault} onClick={() => void window.agent.setDefaultProvider(provider)}>
              {isDefault ? t("Default") : t("Make default")}
            </button>
            {vendor && state.secrets[vendor.id] && (
              <button
                className="btn danger"
                onClick={async () => {
                  await window.agent.saveSecret(vendor.id, null);
                  listed.delete(provider);
                  setResult(null);
                }}
              >
                {t("Remove key")}
              </button>
            )}
          </div>
          <Outcome result={result} />
        </div>
      )}
    </div>
  );
}

// -- an agent's provider and model ----------------------------------------------------

export function ModelPick({ agent, state }: { agent: AgentId; state: AppState }) {
  const choice = state.settings.agents[agent].model;
  const fallback = state.settings.defaultProvider;
  const [list] = useModels(choice?.provider ?? null, !!choice && present(state, choice.provider));
  const save = (next: ModelChoice | null) => void window.agent.saveAgent(agent, { model: next });
  const resolved = resolveChoice({ ...state.settings, agents: { ...state.settings.agents, [agent]: { ...state.settings.agents[agent], model: null } } }, agent);
  const defaultLine = fallback ? `${t("Default")} · ${t(PROVIDER_LABEL[fallback])}${resolved?.model ? ` · ${resolved.model}` : ""}` : t("Default (none chosen yet)");
  const providerDefault = choice ? state.settings.providers[choice.provider]?.model : "";
  return (
    <div className="model-pick">
      <select className="select" aria-label={t("Provider")} value={choice?.provider ?? ""} onChange={(e) => save(e.target.value ? { provider: e.target.value as ProviderId, model: "" } : null)}>
        <option value="">{defaultLine}</option>
        {PROVIDER_IDS.map((p) => (
          <option key={p} value={p}>
            {t(PROVIDER_LABEL[p])}
            {present(state, p) ? "" : ` (${isKeyVendor(p) ? t("no key") : t("not found")})`}
          </option>
        ))}
      </select>
      {choice && (
        <ModelSelect
          value={choice.model}
          list={list}
          label={t("Model")}
          empty={providerDefault ? t("provider default · {model}", { model: providerDefault }) : t("provider default")}
          onChange={(model) => save({ ...choice, model })}
        />
      )}
    </div>
  );
}

// -- the page -------------------------------------------------------------------------

function platformWhy(detail: string | null, platform: "ios" | "android"): string {
  if (platform === "ios") {
    if (detail === "no-xcode") return t("Xcode not found");
    if (detail === "xcode-unopened") return t("Xcode is installed but was never opened");
    return t("iOS builds need a Mac");
  }
  return detail === "no-jdk" ? t("Android SDK found but no JDK") : t("Android SDK not found");
}

export function ModelsPage({ state, open = null }: { state: AppState; open?: string | null }) {
  const d = state.detected;
  const [looking, setLooking] = useState(false);
  return (
    <>
      <Head title={t("Models")} text={t("The agents write with this machine's own subscription or key. Keys never leave this machine.")}>
        <button
          className="btn"
          disabled={looking}
          onClick={async () => {
            setLooking(true);
            await window.agent.detect();
            listed.clear();
            setLooking(false);
          }}
        >
          {t("Look again")}
        </button>
      </Head>
      <p className="lead">{t("Enter a key for each provider you want to use; its models are read from it and you pick one. Every agent writes with the provider marked default, on that provider's default model -- unless it is pinned to a provider of its own below.")}</p>
      <div className="plist">
        {PROVIDER_IDS.map((p) => (
          <ProviderCard key={p} state={state} provider={p} opened={open === p} />
        ))}
      </div>
      <div className="card form">
        <div className="sec">
          <h3>{t("Which agent uses which model")}</h3>
        </div>
        <table>
          <tbody>
            {AGENTS.map((agent) => {
              const own = state.settings.agents[agent];
              const ok = usable(state, resolveChoice(state.settings, agent));
              return (
                <tr key={agent}>
                  <td style={{ width: 120 }}>{AGENT_NAME[agent]}</td>
                  <td>{own.enabled ? <ModelPick agent={agent} state={state} /> : <span className="mono">{t("off on this machine")}</span>}</td>
                  <td style={{ width: 120, textAlign: "right" }}>{own.enabled && <span className={`pill inline ${ok ? "p-idle" : "p-warn"}`}>{ok ? t("ready") : t("no model")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card form">
        <div className="sec">
          <h3>{t("Platforms this machine builds")}</h3>
        </div>
        <div className="meta">
          <span>
            iOS <b>{d.ios.ok ? d.ios.detail : platformWhy(d.ios.detail, "ios")}</b>
          </span>
          <span>
            Android <b>{d.android.ok ? d.android.detail : platformWhy(d.android.detail, "android")}</b>
          </span>
        </div>
      </div>
    </>
  );
}
