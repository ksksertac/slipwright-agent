import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WorkerClient } from "../src/main/client";
import { PROTOCOL, PROTOCOL_HEADER } from "../src/main/protocol";
import { DirectTransport, TransportError } from "../src/main/transport";

describe("the protocol it speaks", () => {
  it("is said with every request, and a server that no longer speaks it is told apart from a lost pairing", async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers[PROTOCOL_HEADER] as string | undefined);
      res.writeHead(426, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "this server needs protocol 2" }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    try {
      const client = new WorkerClient(new DirectTransport(`http://127.0.0.1:${port}`), "swk_x");
      const asked = client.heartbeat();
      await expect(asked).rejects.toBeInstanceOf(TransportError); // not Unpaired: kept
      await expect(asked).rejects.toThrow(/update Slipwright Agent: this server needs protocol 2/);
      expect(seen).toEqual([String(PROTOCOL)]);
    } finally {
      server.close();
    }
  });
});
