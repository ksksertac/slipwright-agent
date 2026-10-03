// What a machine says it is (protocol 2): read off the system, said once per connection and
// again when it changes, and never in the way of the poll -- an older server answers 404.

import { describe, expect, it, vi } from "vitest";
import type { AgentId, ResolvedChoice } from "@shared/types";
import { linuxName, windowsName, writersOf, type MachineAbout } from "../src/main/about";
import type { WorkerClient } from "../src/main/client";
import { Worker, type WorkerHost } from "../src/main/worker";

const choice = (provider: string, model = ""): ResolvedChoice =>
  ({ provider, model, baseUrl: null, maxTokens: null }) as ResolvedChoice;

describe("the system it names", () => {
  it("is the distribution and its version, without the codename", () => {
    const ubuntu = 'NAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n';
    expect(linuxName(ubuntu)).toBe("Ubuntu 24.04");
    expect(linuxName('NAME="Debian GNU/Linux"\nVERSION_ID="12"\n')).toBe("Debian 12");
    expect(linuxName('PRETTY_NAME="Arch Linux"\n')).toBe("Arch Linux");
  });

  it("tells Windows 11 from 10 by the build, since both say 10.0", () => {
    expect(windowsName("10.0.26200")).toBe("Windows 11");
    expect(windowsName("10.0.19045")).toBe("Windows 10");
  });
});

describe("what writes on it", () => {
  it("is each tool and model an agent asking for work uses, once", () => {
    const models: Record<AgentId, ResolvedChoice | null> = {
      backend: choice("claude-code", "sonnet"),
      web: choice("codex", "gpt-5"),
      mobile: choice("claude-code", "sonnet"),
      devops: choice("anthropic", "claude-opus-5-5"),
    };
    const caps = ["write:backend", "write:general", "write:docs", "write:web", "write:mobile", "ios"];
    expect(writersOf(caps, (a) => models[a])).toEqual(["Claude Code sonnet", "Codex gpt-5"]);
    // devops asks for infra; switched on, its vendor is named without the settings' gloss
    expect(writersOf([...caps, "write:infra"], (a) => models[a])).toContain("Anthropic claude-opus-5-5");
  });

  it("leaves out an agent that does not ask for work", () => {
    expect(writersOf(["ios"], () => choice("claude-code", "opus"))).toEqual([]);
  });
});

describe("saying it to the server", () => {
  function run(aboutStatus: number, said: () => MachineAbout) {
    let polls = 0;
    const told: MachineAbout[] = [];
    const client = {
      poll: vi.fn(async () => {
        polls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return null;
      }),
      about: vi.fn(async (body: MachineAbout) => {
        told.push(body);
        return aboutStatus === 204;
      }),
    } as unknown as WorkerClient;
    const host = {
      client: () => client,
      name: () => "ec2-backend",
      capabilities: () => ["write:backend"],
      holding: () => null,
      maxConcurrent: () => 1,
      connected: () => undefined,
      about: async () => said(),
    } as unknown as WorkerHost;
    return { worker: new Worker(host), told, polls: () => polls };
  }

  it("is said once, and again only when it changes", async () => {
    let model = "sonnet";
    const { worker, told, polls } = run(204, () => ({ os: "Ubuntu 24.04", host: "aws-ec2", size: "c7i.xlarge", writers: [`Claude Code ${model}`] }));
    worker.start();
    await vi.waitFor(() => expect(polls()).toBeGreaterThan(3));
    expect(told).toHaveLength(1);
    model = "opus";
    await vi.waitFor(() => expect(told).toHaveLength(2));
    await worker.stop();
    expect(told[1]!.writers).toEqual(["Claude Code opus"]);
  });

  it("to a server too old to ask, changes nothing: the machine keeps asking for work", async () => {
    const { worker, told, polls } = run(404, () => ({ os: "Windows 11" }));
    worker.start();
    await vi.waitFor(() => expect(polls()).toBeGreaterThan(3));
    await worker.stop();
    expect(told).toHaveLength(1); // not asked again and again
  });
});
