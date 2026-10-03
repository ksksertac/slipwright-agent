// A newer Slipwright Agent, from this repository's releases (electron-builder.yml, publish).
//
// The app is released apart from the server now, and a team's laptops are not going to be
// updated by hand. On Windows and in a Linux AppImage it downloads quietly and installs on
// the next quit, with one notification to say so. Not on a Mac: an app that is not signed
// and notarized cannot replace itself there, so it is left to the person (README, Signing).

import { app } from "electron";
import { autoUpdater } from "electron-updater";

const EVERY_MS = 6 * 60 * 60_000;

export function watchForUpdates(): void {
  if (!app.isPackaged || process.platform === "darwin") return;
  // a .deb is updated by its package manager, never by the app
  if (process.platform === "linux" && !process.env.APPIMAGE) return;
  const look = () =>
    void autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // offline, or GitHub unreachable: the next look is in six hours
    });
  look();
  setInterval(look, EVERY_MS).unref();
}
