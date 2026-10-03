// What this machine is, as the server's build room draws it on the machine's card: its
// system, the cloud and size it was rented as, and what writes on it (protocol 2,
// docs/machines-protocol.md "What it is"). Shown only -- the server routes on
// capabilities, never on this -- so every part is a best guess and any may be missing.

import { readFileSync } from "node:fs";
import { release } from "node:os";
import { AGENTS, type AgentId, type ResolvedChoice } from "@shared/types";
import { isKeyVendor, VENDORS } from "@shared/vendors";
import { DOMAINS } from "./capabilities";
import { output } from "./proc";

export interface MachineAbout {
  os?: string;
  host?: "aws-ec2" | "ec2-mac" | "azure-vm" | "gcp";
  size?: string;
  writers?: string[];
}

/** "Ubuntu 24.04" from /etc/os-release: the name and the version, without the codename
 *  and "LTS" a card has no room for. */
export function linuxName(osRelease: string): string | null {
  const field = (key: string) => osRelease.match(new RegExp(`^${key}="?([^"\\n]*)"?$`, "m"))?.[1]?.trim() || null;
  const name = field("NAME");
  const version = field("VERSION_ID");
  if (name) return version ? `${name.replace(/ GNU\/Linux$/, "")} ${version}` : name;
  return field("PRETTY_NAME");
}

/** Windows says 10.0 for both; 11 is told by its build number. */
export function windowsName(osRelease: string): string {
  const build = Number(osRelease.split(".")[2] ?? 0);
  return build >= 22000 ? "Windows 11" : "Windows 10";
}

async function osName(): Promise<string | null> {
  if (process.platform === "win32") return windowsName(release());
  if (process.platform === "darwin") {
    const version = (await output("sw_vers", ["-productVersion"], 5000))?.trim();
    return version ? `macOS ${version}` : "macOS";
  }
  try {
    return linuxName(readFileSync("/etc/os-release", "utf8")) ?? "Linux";
  } catch {
    return "Linux";
  }
}

// -- the cloud ------------------------------------------------------------------------
// Each cloud answers on an address of its own that only exists inside it. A laptop has
// none of them, so each is given well under a second, and the answer is asked once.

const LOOK_MS = 800;

async function get(url: string, headers: Record<string, string>, method = "GET"): Promise<string | null> {
  try {
    const got = await fetch(url, { method, headers, signal: AbortSignal.timeout(LOOK_MS) });
    return got.ok ? (await got.text()).trim() || null : null;
  } catch {
    return null;
  }
}

async function aws(): Promise<Pick<MachineAbout, "host" | "size"> | null> {
  // IMDSv2: a token first; an instance that still allows v1 answers this too
  const token = await get("http://169.254.169.254/latest/api/token", { "X-aws-ec2-metadata-token-ttl-seconds": "60" }, "PUT");
  if (!token) return null;
  const size = await get("http://169.254.169.254/latest/meta-data/instance-type", { "X-aws-ec2-metadata-token": token });
  if (!size) return null;
  return { host: size.startsWith("mac") ? "ec2-mac" : "aws-ec2", size };
}

async function azure(): Promise<Pick<MachineAbout, "host" | "size"> | null> {
  const size = await get("http://169.254.169.254/metadata/instance/compute/vmSize?api-version=2021-02-01&format=text", { Metadata: "true" });
  return size ? { host: "azure-vm", size } : null;
}

async function gcp(): Promise<Pick<MachineAbout, "host" | "size"> | null> {
  const type = await get("http://metadata.google.internal/computeMetadata/v1/instance/machine-type", { "Metadata-Flavor": "Google" });
  return type ? { host: "gcp", size: type.split("/").pop() || type } : null;
}

let place: Promise<Pick<MachineAbout, "host" | "size"> | null> | null = null;
/** Where it runs, asked once: a machine does not move to another cloud while it runs. */
function cloud(): Promise<Pick<MachineAbout, "host" | "size"> | null> {
  place ??= Promise.all([aws(), azure(), gcp()]).then((found) => found.find((f) => f !== null) ?? null);
  return place;
}

let system: Promise<string | null> | null = null;

// -- what writes on it ------------------------------------------------------------------

const TOOL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

/** "Claude Code sonnet", one for each tool and model an agent that asks for work writes
 *  with: two agents on the same model are one line. */
export function writersOf(capabilities: string[], model: (agent: AgentId) => ResolvedChoice | null): string[] {
  const out: string[] = [];
  for (const agent of AGENTS) {
    if (!DOMAINS[agent].some((d) => capabilities.includes(`write:${d}`))) continue;
    const choice = model(agent);
    if (!choice) continue;
    // "Anthropic (Claude)" is a settings page's name; on a card the vendor is enough
    const tool = TOOL[choice.provider] ?? (isKeyVendor(choice.provider) ? VENDORS[choice.provider].label.replace(/ \(.*\)$/, "") : choice.provider);
    const line = choice.model ? `${tool} ${choice.model}` : tool;
    if (!out.includes(line)) out.push(line);
  }
  return out.slice(0, 6);
}

export async function machineAbout(capabilities: string[], model: (agent: AgentId) => ResolvedChoice | null): Promise<MachineAbout> {
  system ??= osName();
  const [os, where] = await Promise.all([system, cloud()]);
  return { ...(os ? { os } : {}), ...(where ?? {}), writers: writersOf(capabilities, model) };
}
