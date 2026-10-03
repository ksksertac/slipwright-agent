// A newer Slipwright Agent, from this repository's releases (electron-builder.yml, publish).
//
// The app is released apart from the server, and a team's laptops are not going to be
// updated by hand -- but not behind anybody's back either. It used to download quietly and
// install on the next quit, with one notification; a person who never quits a tray app
// (nobody does) sat on the old version, pasting codes into a release whose relay box could
// not seal, with nothing on screen to say a fix was out. Now the window says so, as
// Slipwright's own page does: the version is in the corner, a newer one opens a dialog,
// one press downloads it and another restarts into it.
//
// On a Mac the updater's own way (Squirrel.Mac) needs a Developer ID this app does not have,
// so it downloads and swaps the bundle itself (macupdate.ts) -- which also keeps the copy
// free of the quarantine flag that made Gatekeeper call every browser-downloaded version
// "damaged". A .deb belongs to its package manager, and a Mac copy run from the .dmg or a
// folder it cannot write to cannot replace itself: those are offered the release page.

import { app, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import type { UpdateView } from "@shared/types";
import { canReplaceItself, fetchBundle, runningBundle, swapAndRelaunch, zipName } from "./macupdate";

const EVERY_MS = 6 * 60 * 60_000;
const RELEASES = "https://github.com/ksksertac/slipwright-agent/releases/latest";
const LATEST = "https://api.github.com/repos/ksksertac/slipwright-agent/releases/latest";

/** How this copy is updated: by electron-updater, by swapping its own Mac bundle, or by a
 *  person from the release page. */
function howUpdated(): "updater" | "mac" | "page" {
  if (process.platform === "darwin") return app.isPackaged && canReplaceItself() ? "mac" : "page";
  return process.platform !== "linux" || process.env.APPIMAGE ? "updater" : "page";
}

const how = howUpdated();
let view: UpdateView = { phase: "none", version: null, notes: null, percent: 0, error: null, self: how !== "page", mac: process.platform === "darwin" };
// the Mac's: where the newer zip is, and the unpacked bundle waiting for the restart
let macZip: string | null = null;
let macFresh: string | null = null;
let changed: () => void = () => {};

function set(patch: Partial<UpdateView>): void {
  view = { ...view, ...patch };
  changed();
}

export function updateView(): UpdateView {
  return view;
}

/** GitHub's notes are HTML through the updater's feed and Markdown through the API; the
 *  dialog shows them as text either way, never as markup from the network. */
export function plainNotes(notes: UpdateInfo["releaseNotes"] | string | undefined): string | null {
  const text = Array.isArray(notes) ? notes.map((n) => n.note ?? "").join("\n\n") : (notes ?? "");
  const out = text
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out || null;
}

export function isNewer(tag: string, than: string): boolean {
  const parts = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  const [a, b] = [parts(tag), parts(than)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** A Mac or a .deb only needs to know there is one; GitHub's API says so without the
 *  updater, which on a Mac would go on to try what it cannot finish. */
async function lookAtThePage(): Promise<void> {
  const r = await fetch(LATEST, {
    headers: { accept: "application/vnd.github+json", "user-agent": "slipwright-agent" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return;
  const release = (await r.json()) as { tag_name?: string; body?: string; assets?: { name?: string; browser_download_url?: string }[] };
  const tag = String(release.tag_name ?? "");
  macZip = release.assets?.find((a) => a.name === zipName())?.browser_download_url ?? null;
  if (tag && isNewer(tag, app.getVersion())) set({ phase: "available", version: tag.replace(/^v/, ""), notes: plainNotes(release.body) });
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return;
  // a download under way, or one waiting for its restart, is not asked about again
  if (view.phase === "downloading" || view.phase === "ready") return;
  try {
    if (how === "updater") await autoUpdater.checkForUpdates();
    else await lookAtThePage();
  } catch {
    // offline, or GitHub unreachable: the next look is in six hours, or a press away
  }
}

export async function downloadUpdate(): Promise<void> {
  // a Mac release without its zip (an older one, or a build that failed half-way) is
  // still one a person can install from the page
  if (how === "page" || (how === "mac" && !macZip)) {
    void shell.openExternal(RELEASES);
    return;
  }
  if (view.phase !== "available" && view.phase !== "error") return;
  set({ phase: "downloading", percent: 0, error: null });
  try {
    if (how === "mac") {
      macFresh = await fetchBundle(macZip!, (percent) => set({ phase: "downloading", percent }));
      set({ phase: "ready", percent: 100 });
    } else {
      await autoUpdater.downloadUpdate();
    }
  } catch (e) {
    set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/** Quits into the installer. The window's close is a hide (the tray keeps the app), so the
 *  caller marks the app as quitting first, or the installer would wait on a hidden window. */
export function installUpdate(): boolean {
  if (view.phase !== "ready") return false;
  if (how === "mac") {
    const bundle = runningBundle();
    if (!macFresh || !bundle) return false;
    swapAndRelaunch(macFresh, bundle);
    app.quit();
    return true;
  }
  // isSilent false: the installer shows its progress, so a person is not left looking at
  // nothing for the seconds it takes; forceRunAfter: the app comes back on its own
  autoUpdater.quitAndInstall(false, true);
  return true;
}

export function watchForUpdates(onChange: () => void): void {
  changed = onChange;
  if (!app.isPackaged) return;
  if (how === "updater") {
    // asked first: the download is the person's press, and so is the restart
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-available", (info: UpdateInfo) => set({ phase: "available", version: info.version, notes: plainNotes(info.releaseNotes) }));
    autoUpdater.on("download-progress", (p: { percent: number }) => set({ phase: "downloading", percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => set({ phase: "ready", version: info.version, percent: 100 }));
    autoUpdater.on("error", (e: Error) => {
      // an error while only looking is the network's; it is shown once a press has failed
      if (view.phase === "downloading") set({ phase: "error", error: e.message });
    });
  }
  void checkForUpdates();
  setInterval(() => void checkForUpdates(), EVERY_MS).unref();
}
