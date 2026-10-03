// A newer Slipwright Agent on a Mac, put in place by the app itself.
//
// electron-updater cannot do it here: Squirrel.Mac insists the new copy is signed by the
// same Developer ID as the running one, and this app has none (README, Signing). So it
// used to send a person to the release page -- and a .dmg a browser downloads carries the
// quarantine flag, which made Gatekeeper call every new version "damaged" and offer to
// move it to the Trash. A file this app downloads itself is not quarantined (only an app
// that asks for LSFileQuarantineEnabled marks what it fetches), so a copy unpacked from
// the release's .zip and put where the old one was opens like the old one did.
//
// The swap happens after the app has quit, by a few lines of shell: a bundle cannot be
// replaced while it runs from it.

import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, createWriteStream, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The running .app, or null when this is not a packaged app in a bundle. */
export function runningBundle(execPath = process.execPath): string | null {
  const at = execPath.indexOf(".app/Contents/MacOS/");
  return at < 0 ? null : execPath.slice(0, at + 4);
}

/** Whether this Mac copy can replace itself: a bundle in a folder this user may write to.
 *  An app run from the mounted .dmg, or from a folder an administrator owns, cannot. */
export function canReplaceItself(): boolean {
  const bundle = runningBundle();
  if (!bundle || bundle.startsWith("/Volumes/")) return false;
  try {
    accessSync(dirname(bundle), constants.W_OK);
    accessSync(bundle, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The release's zip for this Mac's processor: CI names them by arch, never by version. */
export function zipName(arch = process.arch): string {
  return `Slipwright-Agent-mac-${arch === "arm64" ? "arm64" : "x64"}.zip`;
}

/** Downloads the zip and unpacks it; the .app it holds, ready to be moved into place. */
export async function fetchBundle(url: string, onPercent: (percent: number) => void): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "slipwright-agent-update-"));
  const zip = join(dir, "update.zip");
  const response = await fetch(url, { headers: { "user-agent": "slipwright-agent" }, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`the download answered ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let got = 0;
  let shown = -1;
  const file = createWriteStream(zip);
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    got += chunk.length;
    if (!file.write(chunk)) await new Promise<void>((ok) => file.once("drain", () => ok()));
    const percent = total ? Math.floor((got / total) * 100) : 0;
    if (percent !== shown) onPercent((shown = percent));
  }
  await new Promise<void>((ok, fail) => file.end((error?: Error | null) => (error ? fail(error) : ok())));
  // ditto keeps what a bundle needs and unzip may lose: symlinks inside the frameworks,
  // extended attributes, the code signature's resource fork
  const out = join(dir, "unpacked");
  const unpacked = spawnSync("/usr/bin/ditto", ["-x", "-k", zip, out], { encoding: "utf8" });
  if (unpacked.status !== 0) throw new Error(`the update could not be unpacked: ${unpacked.stderr || unpacked.status}`);
  const app = readdirSync(out).find((name) => name.endsWith(".app"));
  if (!app) throw new Error("the update holds no app");
  rmSync(zip, { force: true });
  // nothing here should carry it, but a copy that does would be refused the way a browser
  // download is, which is the whole thing this avoids
  spawnSync("/usr/bin/xattr", ["-cr", join(out, app)]);
  return join(out, app);
}

/**
 * Starts the swap and returns; the caller quits the app at once. The shell waits for this
 * process to be gone, moves the old bundle aside, puts the new one in its place and opens
 * it -- and puts the old one back if the move failed, so a failed update is never a
 * missing app.
 */
export function swapAndRelaunch(fresh: string, bundle: string, pid = process.pid): void {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const script = join(dirname(dirname(fresh)), "swap.sh");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done`,
      `old=${q(bundle)}`,
      `new=${q(fresh)}`,
      'aside="$old.previous"',
      'rm -rf "$aside"',
      'mv "$old" "$aside" || exit 1',
      'if /usr/bin/ditto "$new" "$old"; then',
      '  /usr/bin/xattr -cr "$old"',
      '  rm -rf "$aside"',
      "else",
      '  rm -rf "$old"; mv "$aside" "$old"',
      "fi",
      'open "$old"',
      `rm -rf ${q(dirname(dirname(fresh)))}`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  spawn("/bin/sh", [script], { detached: true, stdio: "ignore" }).unref();
}
