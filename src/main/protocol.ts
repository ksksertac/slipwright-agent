// Which version of the worker protocol this app speaks (docs/machines-protocol.md in
// ksksertac/slipwright). The app and the server are released apart now, so each request
// says it: a server that no longer speaks this one answers 426 and the app tells the
// person to update, instead of failing in some way nobody can read.
export const PROTOCOL = 1;
export const PROTOCOL_HEADER = "x-slipwright-protocol";
/** The server's answer to an app it no longer speaks to. */
export const UPGRADE_REQUIRED = 426;
