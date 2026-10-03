// The screens. Each takes the app state the main process pushed and calls back through
// `window.agent`; none of them holds anything of its own that matters past a re-render.

import { useEffect, useState } from "react";
import type { AgentId, AppState, HistoryEntry, Result } from "@shared/types";
import { AGENTS } from "@shared/types";
import { t } from "./i18n";
import logo from "./logo.png";
import { ModelPick } from "./models";
import { AGENT_NAME, AgentCard, DOMAINS, Head, Icon, Outcome, Switch } from "./parts";

export { ModelsPage } from "./models";

export type Go = (page: string) => void;

export function Welcome({ go }: { go: Go }) {
  return (
    <div className="card welcome">
      <img src={logo} alt="" />
      <h3>{t("This machine is not lent to a Slipwright team yet")}</h3>
      <p>{t("Once it is, its agents write phases with your own Claude Code, Codex or API key, and it builds iOS and Android when it can.")}</p>
      <ol>
        <li>{t("In Slipwright, open Settings → Machines → Connect a machine")}</li>
        <li>{t("Copy the code (SW-…); it works for 15 minutes, once")}</li>
        <li>{t("Paste it on the Slipwright team page")}</li>
      </ol>
      <button className="btn primary" onClick={() => go("team")}>
        {t("Connect to a team")}
      </button>
    </div>
  );
}

export function Now({ state, go, now }: { state: AppState; go: Go; now: number }) {
  const running = state.tasks.length;
  return (
    <>
      <Head title={t("Now")} text={t("The agents on this machine and the work they hold. The development's page on Slipwright shows the same.")}>
        {running > 0 && <span className="pill p-run inline">{running === 1 ? t("1 task running") : t("{n} tasks running", { n: running })}</span>}
      </Head>
      {!state.pairing && <Welcome go={go} />}
      <div className="grid2">
        {AGENTS.map((agent) => (
          <AgentCard key={agent} state={state} agent={agent} full={false} now={now} onOpen={() => go(`agent-${agent}`)} />
        ))}
      </div>
    </>
  );
}

// -- an agent -------------------------------------------------------------------------

export function AgentPage({ state, agent, now }: { state: AppState; agent: AgentId; now: number }) {
  const own = state.settings.agents[agent];
  const name = AGENT_NAME[agent];
  return (
    <>
      <Head title={t("{agent} agent", { agent: name })} text={t("Takes {agent} phases on this machine. Its model and whether it is on are set here.", { agent: name })}>
        <div className="row-btns">
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>{t("On this machine")}</span>
          <Switch on={own.enabled} label={t("On this machine")} onChange={(on) => void window.agent.saveAgent(agent, { enabled: on })} />
        </div>
      </Head>
      <AgentCard state={state} agent={agent} full now={now} />
      <div className="card form">
        <div className="field">
          <label>{t("Model")}</label>
          <ModelPick agent={agent} state={state} />
        </div>
        <div className="meta">
          <span>
            {t("Writes the domains")} <b>{DOMAINS[agent].join(", ")}</b>
          </span>
        </div>
      </div>
    </>
  );
}

// -- History --------------------------------------------------------------------------

const OUTCOME_PILL: Record<HistoryEntry["outcome"], string> = {
  answered: "p-idle",
  built: "p-idle",
  "build-failed": "p-bad",
  "taken-back": "p-off",
  failed: "p-bad",
  timeout: "p-warn",
  rejected: "p-warn",
};

export function HistoryPage({ state }: { state: AppState }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  // read again whenever the set of running tasks changes: one finishing is a new line
  const key = state.tasks.map((x) => x.id).join();
  useEffect(() => {
    void window.agent.history().then(setEntries);
  }, [key]);
  return (
    <>
      <Head title={t("History")} text={t("The phases and builds this machine handled.")} />
      <div className="card">
        {entries.length === 0 ? (
          <div className="form empty">{t("Nothing handled yet")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("Phase")}</th>
                <th>{t("Project")}</th>
                <th>{t("Agent")}</th>
                <th>{t("Duration")}</th>
                <th>{t("Outcome")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.id}-${e.at}`}>
                  <td>
                    {e.goal}
                    <div className="mono">
                      {[e.phase ? t("Phase {n}/{m}", { n: e.phase, m: e.phases ?? "?" }) : null, e.jiraKey, new Date(e.at).toLocaleString("tr-TR")].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>{e.project || "—"}</td>
                  <td>{AGENT_NAME[e.agent]}</td>
                  <td>{e.seconds < 60 ? `${e.seconds} sn` : t("{min} min", { min: Math.round(e.seconds / 60) })}</td>
                  <td>
                    <span className={`pill inline ${OUTCOME_PILL[e.outcome]}`} title={e.detail ?? undefined}>
                      {t(e.outcome)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// -- Team -----------------------------------------------------------------------------

export function TeamPage({ state }: { state: AppState }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const p = state.pairing;
  const connect = async () => {
    setBusy(true);
    setResult(null);
    const r = await window.agent.pair(code);
    setBusy(false);
    setResult(r.ok ? null : r);
    if (r.ok) setCode("");
  };
  return (
    <>
      <Head title={t("Slipwright team")} text={t("Which Slipwright this machine is connected to, and as what.")} />
      <div className="card form">
        {p ? (
          <>
            <div className={`ok-line${state.connection === "offline" ? " bad" : ""}`}>
              {state.connection === "offline" ? Icon.cross : Icon.check}{" "}
              {t("Connected: {where}", { where: p.relay ? p.relay.host : (p.address ?? "").replace(/^https?:\/\//, "") })}
            </div>
            <div className="meta">
              <span>
                {p.relay ? t("Relay") : t("LAN")} <b>{p.relay ? p.relay.host : p.address}</b>
              </span>
              <span>
                {t("Connection")} <b>{p.relay ? t("end-to-end encrypted") : t("on this network")}</b>
              </span>
              <span>
                {t("Machine name")} <b>{state.machineName}</b>
              </span>
              <span>
                {t("Machine key")} <b>{t("in the system keychain")}</b>
              </span>
            </div>
            {state.connectionError && state.connection === "offline" && (
              <div className="meta">
                <span>
                  {t("Last error")} <b>{state.connectionError}</b>
                </span>
              </div>
            )}
          </>
        ) : (
          state.connectionError && <Outcome result={{ ok: false, message: state.connectionError }} />
        )}
        <div className="sec">
          <h3>{p ? t("Connect to another team") : t("Connect to a team")}</h3>
          <p>{t("Paste the code from Slipwright's Settings → Machines → Connect a machine. A code works for 15 minutes, once.")}</p>
        </div>
        <div className="field">
          <label htmlFor="code">{t("Connection code")}</label>
          <div className="input">
            <input id="code" value={code} placeholder="SW-XXXX-XXXX-XXXX-XXXX" spellCheck={false} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code.trim() && void connect()} />
          </div>
        </div>
        <Outcome result={result} />
        <div className="row-btns">
          <button className="btn primary" disabled={busy || !code.trim()} onClick={() => void connect()}>
            {busy ? t("Connecting…") : t("Connect")}
          </button>
          {p && (
            <button className="btn danger" title={t("This machine forgets the pairing. Remove it on Slipwright's Machines page too.")} onClick={() => void window.agent.forget()}>
              {t("Leave this team")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// -- Source ---------------------------------------------------------------------------

export function SourcePage({ state }: { state: AppState }) {
  const [github, setGithub] = useState("");
  const [bbUser, setBbUser] = useState(state.settings.bitbucket.user ?? "");
  const [bbPass, setBbPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(state.settings.github.user ? { ok: true, message: `GitHub: ${state.settings.github.user}` } : null);
  const save = async () => {
    setBusy(true);
    const r = await window.agent.saveSource(github.trim() || null, bbUser.trim(), bbPass.trim() || null);
    setBusy(false);
    setResult(r);
    setGithub("");
    setBbPass("");
  };
  return (
    <>
      <Head title={t("Source")} text={t("The agents read the project's code from here. Read access is enough: only Slipwright writes to the branch.")} />
      <div className="card form">
        <div className="field">
          <label htmlFor="gh">{t("GitHub token")}</label>
          <div className="input">
            <input id="gh" type="password" value={github} placeholder={state.secrets.github ?? "github_pat_…"} onChange={(e) => setGithub(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="bbu">{t("Bitbucket (optional)")}</label>
          <div className="row-btns">
            <div className="input" style={{ flex: 1 }}>
              <input id="bbu" value={bbUser} placeholder={t("Bitbucket username")} onChange={(e) => setBbUser(e.target.value)} />
            </div>
            <div className="input" style={{ flex: 1 }}>
              <input type="password" aria-label={t("App password")} value={bbPass} placeholder={state.secrets.bitbucket ?? t("App password")} onChange={(e) => setBbPass(e.target.value)} />
            </div>
          </div>
        </div>
        <Outcome result={result} />
        <div className="meta">
          <span>{t("Without a token the agents answer from the prompt alone.")}</span>
          {(state.secrets.github || state.secrets.bitbucket) && <span>{t("Leave empty to keep the saved one")}</span>}
        </div>
        <div className="row-btns">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? t("Testing…") : t("Save and test")}
          </button>
          {state.secrets.github && (
            <button
              className="btn"
              onClick={async () => {
                setResult(await window.agent.saveSource("", null, null));
              }}
            >
              {t("Remove")} GitHub
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// -- Jira -----------------------------------------------------------------------------

export function JiraPage({ state }: { state: AppState }) {
  const [site, setSite] = useState(state.settings.jira.site);
  const [email, setEmail] = useState(state.settings.jira.email);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  return (
    <>
      <Head title="Jira" text={t('When a phase is taken, its issue moves to "In Progress" under your name. Optional.')} />
      <div className="card form">
        <div className="field">
          <label htmlFor="js">{t("Site")}</label>
          <div className="input">
            <input id="js" value={site} placeholder="acme.atlassian.net" onChange={(e) => setSite(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="je">{t("E-mail")}</label>
          <div className="input">
            <input id="je" value={email} placeholder="ayse@acme.com" onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="jt">{t("API token")}</label>
          <div className="input">
            <input id="jt" type="password" value={token} placeholder={state.secrets.jira ?? "ATATT…"} onChange={(e) => setToken(e.target.value)} />
          </div>
        </div>
        <Outcome result={result && result.ok && result.message ? { ok: true, message: t("Connected as {name}", { name: result.message }) } : result} />
        <div className="row-btns">
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setResult(await window.agent.saveJira(site, email, token.trim() || null));
              setBusy(false);
              setToken("");
            }}
          >
            {busy ? t("Testing…") : t("Save and test")}
          </button>
        </div>
      </div>
    </>
  );
}

// -- Settings -------------------------------------------------------------------------

export function SettingsPage({ state }: { state: AppState }) {
  const s = state.settings;
  const [max, setMax] = useState(String(s.maxConcurrent));
  const [withSecrets, setWithSecrets] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  // a newer one opens its own dialog; only "nothing newer" needs saying here
  const check = async () => {
    setChecking(true);
    await window.agent.checkForUpdates();
    setChecking(false);
    setChecked(true);
  };
  const toggles: [keyof typeof s, string, string][] = [
    ["runBuilds", t("Run build and test commands on this machine"), t("The commands the agents wrote run in a folder of their own, with a restricted environment.")],
    ["startAtLogin", t("Start when the computer starts"), t("Runs in the background with a tray icon.")],
    ["notOnBattery", t("Do not take work on battery"), t("A laptop that is not plugged in takes no new phase.")],
    ["notifyDone", t("Notify when a task is done"), ""],
  ];
  return (
    <>
      <Head title={t("Settings")} text={t("How this machine works.")} />
      <div className="card form">
        {toggles.map(([key, title, text]) => (
          <div className="toggle-row" key={key}>
            <div className="sec">
              <h3>{title}</h3>
              {text && <p>{text}</p>}
            </div>
            <Switch on={!!s[key]} label={title} onChange={(on) => void window.agent.saveSettings({ [key]: on })} />
          </div>
        ))}
        <div className="field">
          <label htmlFor="par">{t("At most this many tasks at once")}</label>
          <div className="input" style={{ maxWidth: 120 }}>
            <input id="par" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} onBlur={() => void window.agent.saveSettings({ maxConcurrent: Number(max) || 1 })} />
          </div>
        </div>
        <div className="field">
          <label>{t("Work folder")}</label>
          <div className="row-btns">
            <div className="input" style={{ flex: 1 }}>
              <input readOnly value={s.workDir} />
            </div>
            <button className="btn" onClick={() => void window.agent.chooseWorkDir()}>
              {t("Change")}
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="theme">{t("Theme")}</label>
          <select id="theme" className="select" style={{ maxWidth: 160 }} value={s.theme} onChange={(e) => void window.agent.saveSettings({ theme: e.target.value as typeof s.theme })}>
            <option value="system">{t("System")}</option>
            <option value="light">{t("Light")}</option>
            <option value="dark">{t("Dark")}</option>
          </select>
        </div>
      </div>
      {/* a server reached over SSH has no window: what is set up here goes there as a file */}
      <div className="card form" style={{ marginTop: 16 }}>
        <div className="sec">
          <h3>{t("Run on a server")}</h3>
          <p>
            {t(
              "On a server you reach over SSH, run slipwright-agent in a folder with a settings.json beside it. This saves the agents and models chosen here as that file; upload it, put a fresh connection code in \"code\" and start it.",
            )}
          </p>
        </div>
        <div className="toggle-row">
          <div className="sec">
            <h3>{t("Put the keys and tokens in the file too")}</h3>
            <p>{t("Otherwise they are written as env: names to set on the server, and no secret leaves this machine.")}</p>
          </div>
          <Switch on={withSecrets} label={t("Put the keys and tokens in the file too")} onChange={setWithSecrets} />
        </div>
        <div className="row-btns">
          <button
            className="btn primary"
            onClick={() =>
              void window.agent.exportServerSettings(withSecrets).then((r) => setExported(r.ok ? r.message : null))
            }
          >
            {t("Save settings.json")}
          </button>
          {exported && <span className="muted small">{t("Saved: {path}", { path: exported })}</span>}
        </div>
      </div>
      <div className="card form" style={{ marginTop: 16 }}>
        <div className="toggle-row">
          <div className="sec">
            <h3>{t("Version {version}", { version: state.version })}</h3>
            {checked && state.update.phase === "none" && <p>{t("This is the newest version.")}</p>}
          </div>
          <button className="btn" disabled={checking} onClick={() => void check()}>
            {t("Check for updates")}
          </button>
        </div>
      </div>
    </>
  );
}

