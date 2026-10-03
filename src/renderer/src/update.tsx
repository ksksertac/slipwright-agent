// A newer version, said where a person looks: the corner under the version, and a dialog
// that opens by itself once for each thing it has to say -- that one is out, then that it
// is downloaded -- and from the corner whenever somebody wants it back (src/main/updates.ts).

import { useEffect, useState } from "react";
import type { AppState } from "@shared/types";
import { t } from "./i18n";
import logo from "./logo.png";

// what was put away with "Later", as version:phase, so the same news is not shown twice but
// the next part of it is; kept across restarts, and nothing breaks where storage is refused
const KEY = "update.dismissed";
function readDismissed(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeDismissed(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // shown again on the next start; no worse than that
  }
}

/** Whether the dialog is open, and the press that opens it from the corner. */
export function useUpdateDialog(state: AppState): { open: boolean; show: () => void; hide: () => void } {
  const u = state.update;
  // a download in progress is still the "available" news; only "ready" is new again
  const news = u.version ? `${u.version}:${u.phase === "ready" ? "ready" : "out"}` : null;
  const [dismissed, setDismissed] = useState(readDismissed);
  const [forced, setForced] = useState(false);
  useEffect(() => setForced(false), [news]);
  const open = u.phase !== "none" && (forced || news !== dismissed);
  return {
    open,
    show: () => setForced(true),
    hide: () => {
      setForced(false);
      if (news) {
        writeDismissed(news);
        setDismissed(news);
      }
    },
  };
}

export function UpdateBadge({ state, show }: { state: AppState; show: () => void }) {
  const u = state.update;
  if (u.phase === "none" || !u.version) return null;
  return (
    <button className="upd" onClick={show}>
      {u.phase === "downloading"
        ? t("Downloading… {n}%", { n: u.percent })
        : u.phase === "ready"
          ? t("v{version} is ready", { version: u.version })
          : t("v{version} is out", { version: u.version })}
    </button>
  );
}

export function UpdateDialog({ state, hide }: { state: AppState; hide: () => void }) {
  const u = state.update;
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [hide]);
  if (u.phase === "none" || !u.version) return null;

  let body: React.ReactNode;
  let action: React.ReactNode;
  if (!u.self) {
    body = <p>{t("This copy cannot replace itself: download it from the release page and install it over this one.")}</p>;
    action = (
      <button className="btn primary" onClick={() => void window.agent.downloadUpdate()}>
        {t("Open the download page")}
      </button>
    );
  } else if (u.phase === "downloading") {
    body = (
      <div className="prog" role="progressbar" aria-valuenow={u.percent} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${u.percent}%` }} />
      </div>
    );
    action = (
      <button className="btn primary" disabled>
        {t("Downloading… {n}%", { n: u.percent })}
      </button>
    );
  } else if (u.phase === "ready") {
    body = (
      <>
        <p>{t("Downloaded. The app closes, installs it and opens again.")}</p>
        {state.tasks.length > 0 && <p>{t("A phase this machine is writing now is taken back by Slipwright and written by the account's own model.")}</p>}
      </>
    );
    action = (
      <button className="btn primary" onClick={() => void window.agent.installUpdate()}>
        {t("Restart and install")}
      </button>
    );
  } else {
    body = u.phase === "error" && <p className="ok-line bad">{t("The download did not finish: {error}", { error: u.error ?? "" })}</p>;
    action = (
      <button className="btn primary" onClick={() => void window.agent.downloadUpdate()}>
        {u.phase === "error" ? t("Try again") : t("Download")}
      </button>
    );
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && hide()}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby="upd-title">
        <div className="top">
          <img src={logo} alt="" />
          <div>
            <h3 id="upd-title">{t("Slipwright Agent {version} is out", { version: u.version })}</h3>
            <p>{t("You have {version}.", { version: state.version })}</p>
          </div>
        </div>
        {u.notes && (
          <div className="notes">
            <b>{t("What changes")}</b>
            {u.notes}
          </div>
        )}
        {body}
        <div className="row-btns">
          <button className="btn" onClick={hide}>
            {t("Later")}
          </button>
          {action}
        </div>
      </div>
    </div>
  );
}
