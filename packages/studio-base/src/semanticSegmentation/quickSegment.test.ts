/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { QUICK_SEGMENT_URL, quickSegment } from "./quickSegment";

type Sent = { frameToken: string; hasImage: boolean };

/** The parts of a fetch Response that quickSegment reads (jsdom has no Response). */
type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function respond(status: number, body: string): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) };
}

function setup(responses: (() => FakeResponse)[]) {
  const sent: Sent[] = [];
  Object.assign(globalThis, {
    createImageBitmap: jest.fn(async () => ({ width: 4, height: 2, close: () => undefined })),
    OffscreenCanvas: class {
      public getContext() {
        return { drawImage: () => undefined };
      }
      public async convertToBlob() {
        return new Blob(["jpeg"]);
      }
    },
    fetch: jest.fn(async (url: string, init?: RequestInit) => {
      if (url !== `${QUICK_SEGMENT_URL}/segment`) {
        return { blob: async () => new Blob(["frame"]) };
      }
      const form = init!.body as FormData;
      const request = JSON.parse(form.get("request") as string) as { frameToken: string };
      sent.push({ frameToken: request.frameToken, hasImage: form.get("image") != undefined });
      return responses.shift()!();
    }),
  });
  return sent;
}

const ok = () => respond(200, JSON.stringify({ counts: "08", width: 4, height: 2, score: 0.9 }));
const request = (imageUrl: string) => ({
  topic: "/camera",
  logTimeNs: "1000000123456",
  width: 4,
  height: 2,
  imageUrl,
  points: [{ x: 0.5, y: 0.5, positive: true }],
});

it("uploads a frame once under a random token and reuses it for further clicks on that frame", async () => {
  const sent = setup([ok, ok, ok]);
  await quickSegment(request("blob:a"));
  await quickSegment(request("blob:a"));
  // The same topic and time on another displayed image (e.g. another recording) uploads again.
  await quickSegment(request("blob:b"));
  expect(sent.map((item) => item.hasImage)).toEqual([true, false, true]);
  expect(sent[1]!.frameToken).toBe(sent[0]!.frameToken);
  expect(sent[2]!.frameToken).not.toBe(sent[0]!.frameToken);
});

it("uploads again when the server no longer holds the cached frame", async () => {
  const sent = setup([
    ok,
    () => respond(400, JSON.stringify({ error: "Upload the displayed frame" })),
    ok,
  ]);
  await quickSegment(request("blob:c"));
  await quickSegment(request("blob:c"));
  expect(sent.map((item) => item.hasImage)).toEqual([true, false, true]);
  expect(sent[2]!.frameToken).not.toBe(sent[0]!.frameToken);
});

it("reports the HTTP status when a proxy answers with a page instead of JSON", async () => {
  setup([() => respond(502, "<html>Bad gateway</html>")]);
  await expect(quickSegment(request("blob:d"))).rejects.toThrow("HTTP 502");
});
