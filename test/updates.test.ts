import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getVersion: () => "1.0.0" }, shell: {} }));
vi.mock("electron-updater", () => ({ autoUpdater: {} }));

const { isNewer, plainNotes } = await import("../src/main/updates");

describe("a newer version", () => {
  it("is newer by number, not by text", () => {
    expect(isNewer("v1.0.10", "1.0.9")).toBe(true);
    expect(isNewer("v1.1.0", "1.0.99")).toBe(true);
    expect(isNewer("v1.0.2", "1.0.2")).toBe(false);
    expect(isNewer("v1.0.1", "1.0.2")).toBe(false);
  });

  it("has its notes shown as text, never as markup from the network", () => {
    const notes = plainNotes('<h2>What changes</h2><ul><li>The box seals &amp; opens</li><li><img src=x onerror="alert(1)">Pairs</li></ul>');
    expect(notes).toBe("What changes\n• The box seals & opens\n• Pairs");
  });

  it("has no notes when the release says nothing", () => {
    expect(plainNotes(undefined)).toBeNull();
    expect(plainNotes("  ")).toBeNull();
    expect(plainNotes([{ version: "1.0.2", note: "One fix" }])).toBe("One fix");
  });
});

describe("a Mac copy replacing itself", async () => {
  const { runningBundle, zipName } = await import("../src/main/macupdate");

  it("knows its own bundle from the executable's path, and nothing outside one", () => {
    expect(runningBundle("/Applications/Slipwright Agent.app/Contents/MacOS/Slipwright Agent")).toBe("/Applications/Slipwright Agent.app");
    expect(runningBundle("/usr/local/bin/node")).toBeNull();
  });

  it("asks for the zip built for its own processor", () => {
    expect(zipName("arm64")).toBe("Slipwright-Agent-mac-arm64.zip");
    expect(zipName("x64")).toBe("Slipwright-Agent-mac-x64.zip");
  });
});
