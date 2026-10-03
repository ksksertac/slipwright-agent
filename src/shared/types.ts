// What the main process and the page say to each other. The page never sees a secret:
// keys and tokens go in through `save*` calls and come back only as a masked hint.

export const AGENTS = ["backend", "web", "mobile", "devops"] as const;
export type AgentId = (typeof AGENTS)[number];

import type { KeyVendor } from "./vendors";

/** A signed-in CLI, or a vendor called with this machine's own key (shared/vendors.ts). */
export type ProviderId = "claude-code" | "codex" | KeyVendor;

export interface ModelChoice {
  provider: ProviderId;
  /** Empty means the provider's default model, as set under Models. */
  model: string;
}

/** What is set for one provider under Models, as on Slipwright's own Models page. */
export interface ProviderSettings {
  /** The model an agent gets when it names this provider and no model. */
  model: string;
  /** Another host for the same API (a proxy); null for the vendor's own. */
  baseUrl: string | null;
  /** The longest answer asked for in one call; null for the vendor's usual. */
  maxTokens: number | null;
}

/** A choice made whole: the provider, its model, and where and how to call it. */
export interface ResolvedChoice extends ModelChoice {
  baseUrl: string | null;
  maxTokens: number | null;
}

export interface AgentSettings {
  enabled: boolean;
  /** Null: the default provider (Settings.defaultProvider) with its default model. */
  model: ModelChoice | null;
}

export interface Settings {
  paused: boolean;
  startAtLogin: boolean;
  notOnBattery: boolean;
  runBuilds: boolean;
  notifyDone: boolean;
  maxConcurrent: number;
  workDir: string;
  theme: "system" | "light" | "dark";
  agents: Record<AgentId, AgentSettings>;
  /** The one provider every agent with no provider of its own writes with. */
  defaultProvider: ProviderId | null;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
  github: { user: string | null };
  bitbucket: { user: string | null };
  jira: { site: string; email: string; account: string | null };
}

export interface Pairing {
  workerId: string;
  name: string;
  /** "http://192.168.1.20:8000" for a LAN pairing; null through the relay. */
  address: string | null;
  relay: { host: string; room: string } | null;
  pairedAt: string;
}

export type Connection = "unpaired" | "connecting" | "connected" | "offline";

export interface LogLine {
  at: string;
  text: string;
  tone?: "ok" | "bad" | "dim";
}

export interface TaskView {
  id: string;
  kind: "write" | "build";
  agent: AgentId;
  project: string;
  goal: string;
  phase: number | null;
  phases: number | null;
  jiraKey: string | null;
  platform: string | null;
  model: string;
  startedAt: number;
  timeoutS: number;
  status: string;
  log: LogLine[];
}

export interface HistoryEntry {
  id: string;
  kind: "write" | "build";
  agent: AgentId;
  project: string;
  goal: string;
  phase: number | null;
  phases: number | null;
  jiraKey: string | null;
  seconds: number;
  outcome: "answered" | "built" | "build-failed" | "taken-back" | "failed" | "timeout" | "rejected";
  detail: string | null;
  at: string;
}

export interface CliInfo {
  installed: boolean;
  version: string | null;
  /** true / false when it could be told cheaply, null when not. */
  signedIn: boolean | null;
}

export interface Detected {
  claude: CliInfo;
  codex: CliInfo;
  ios: { ok: boolean; detail: string | null };
  android: { ok: boolean; detail: string | null };
  checkedAt: string | null;
}

export type Secrets = Record<KeyVendor, string | null> & {
  github: string | null;
  bitbucket: string | null;
  jira: string | null;
};

/** A newer Slipwright Agent, as the window shows it (src/main/updates.ts). */
export interface UpdateView {
  phase: "none" | "available" | "downloading" | "ready" | "error";
  /** The newer version, without its "v". */
  version: string | null;
  /** Its release notes, as plain text. */
  notes: string | null;
  percent: number;
  error: string | null;
  /** Whether this copy installs it itself; a Mac or a .deb is sent to the release page. */
  self: boolean;
  /** A Mac: one installed by hand also needs its quarantine cleared, or it is "damaged". */
  mac: boolean;
}

export interface AppState {
  version: string;
  update: UpdateView;
  machineName: string;
  pairing: Pairing | null;
  connection: Connection;
  connectionError: string | null;
  /** Why no work is being asked for even though nothing is paused by hand. */
  holding: "battery" | null;
  settings: Settings;
  /** Each secret only as a hint ("sk-ant-…3f9A") or null. */
  secrets: Secrets;
  detected: Detected;
  capabilities: string[];
  tasks: TaskView[];
}

export interface Result {
  ok: boolean;
  message: string;
}

/** The bridge the preload puts on `window.agent`. */
export interface AgentApi {
  state(): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  history(): Promise<HistoryEntry[]>;
  pair(code: string): Promise<Result>;
  forget(): Promise<Result>;
  saveSettings(patch: Partial<Omit<Settings, "agents">>): Promise<void>;
  saveAgent(agent: AgentId, patch: Partial<AgentSettings>): Promise<void>;
  saveSecret(name: keyof Secrets, value: string | null): Promise<void>;
  saveSource(github: string | null, bitbucketUser: string | null, bitbucket: string | null): Promise<Result>;
  saveJira(site: string, email: string, token: string | null): Promise<Result>;
  detect(): Promise<Detected>;
  chooseWorkDir(): Promise<string | null>;
  /** This machine's choices as a settings.json for a server (slipwright-agent). */
  exportServerSettings(withSecrets: boolean): Promise<Result>;
  /** The models a provider offers this machine, with the key typed (not yet saved) or the
   *  one kept; also the connection test. */
  listModels(provider: ProviderId, key: string | null, baseUrl: string | null): Promise<ModelList>;
  saveProvider(provider: ProviderId, patch: Partial<ProviderSettings>): Promise<void>;
  setDefaultProvider(provider: ProviderId | null): Promise<void>;
  /** EVREN refuses every call until its terms are accepted, by a person, for the key. */
  evrenTerms(): Promise<EvrenTerms>;
  acceptEvrenTerms(version: number): Promise<EvrenTerms>;
  checkForUpdates(): Promise<void>;
  /** Downloads the newer version, or opens its release page where it cannot install itself. */
  downloadUpdate(): Promise<void>;
  /** Quits and restarts into the downloaded version. */
  installUpdate(): Promise<void>;
}

export interface ModelList {
  ok: boolean;
  models: string[];
  /** What went wrong, or how many were found, in the person's words. */
  message: string;
  /** EVREN said its terms are not accepted for this key. */
  terms?: boolean;
}

export interface EvrenTerms {
  ok: boolean;
  version: number;
  accepted: boolean;
  text: string;
  message: string;
}
