// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { WebSocketServer } from "ws";

import Logger from "@foxglove/log";
import { FoxgloveServer } from "@foxglove/ws-protocol";

export type WebsocketTest = {
  close: () => Promise<unknown>;
};

const log = Logger.getLogger(__filename);

/**
 * Launch a simulation of a websocket server, using real use case.
 *
 * @returns A close function to exit the websocket server.
 */
export function launchWebsocket(): WebsocketTest {
  function getTimestamp() {
    const now = Date.now();
    return {
      sec: Math.floor(now / 1000),
      nsec: (now % 1000) * 1e6,
    };
  }

  const server = new FoxgloveServer({ name: "websocket-test-server" });

  const ws = new WebSocketServer({
    port: 8765,
    handleProtocols: (protocols) => server.handleProtocols(protocols),
  });

  ws.on("listening", () => {
    log.info("server listening on %s", ws.address());
  });

  ws.on("message", (message) => {
    log.info("message -> ", message);
  });

  ws.on("connection", (conn, req) => {
    const name = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    log.info("connection from %s via %s", name, req.url);
    server.handleConnection(conn, name);
  });

  server.on("subscribe", (chanId) => {
    log.info("first client subscribed to %d", chanId);
  });

  server.on("error", (err) => {
    log.error("server error: %o", err);
  });

  const textEncoder = new TextEncoder();

  const channel = server.addChannel({
    topic: "/websocket_test",
    encoding: "json",
    schemaName: "websocket_test",
    schema: JSON.stringify({
      type: "object",
      properties: {
        hello: { type: "string" },
        fo: { type: "number" },
      },
    }),
  });

  const intervalId = setInterval(() => {
    const testMessage = {
      timestamp: getTimestamp(),
      data: {
        hello: "world",
        foo: 42,
      },
    };

    server.sendMessage(
      channel,
      BigInt(Date.now()) * 1_000_000n,
      textEncoder.encode(JSON.stringify(testMessage)),
    );
  }, 500);

  async function close() {
    clearInterval(intervalId);

    // Close all active connections
    ws.clients.forEach((client) => {
      client.terminate(); // Forcefully close all client connections
    });

    return await new Promise((resolve, reject) => {
      ws.close((err) => {
        if (err) {
          log.error("Error closing WebSocket server: %o", err);
          reject(err);
          return;
        }
        resolve(undefined);
      });
    });
  }

  return {
    close,
  };
}
