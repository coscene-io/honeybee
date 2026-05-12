// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import { MessageEvent } from "@foxglove/studio";
import {
  clearIndexedDbMessageStoreDatabase,
  IndexedDbMessageStore,
} from "@foxglove/studio-base/persistence/IndexedDbMessageStore";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

function messageEvent(seq: number, topic = "/topic"): MessageEvent {
  return {
    topic,
    schemaName: "pkg/Msg",
    receiveTime: { sec: 10, nsec: 1 },
    message: { seq },
    sizeInBytes: 10,
  };
}

describe("IndexedDbMessageStore", () => {
  beforeEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  afterEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  it("flushes queued appends on close", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "close-flush" });
    await store.init();

    await store.append([messageEvent(1), messageEvent(2)]);
    await store.close();

    const reader = new IndexedDbMessageStore({ sessionId: "close-flush" });
    await reader.init();
    const messages = await reader.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });

    expect(messages.map((msg) => msg.message)).toEqual([{ seq: 1 }, { seq: 2 }]);
    await reader.close();
  });

  it("does not overwrite same timestamp messages after reopening the same session", async () => {
    const first = new IndexedDbMessageStore({ sessionId: "same-timestamp" });
    await first.init();
    await first.append([messageEvent(1)]);
    await first.flush();
    await first.close();

    const second = new IndexedDbMessageStore({ sessionId: "same-timestamp" });
    await second.init();
    await second.append([messageEvent(2)]);
    await second.flush();

    const messages = await second.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });

    expect(messages.map((msg) => msg.message)).toEqual([{ seq: 1 }, { seq: 2 }]);
    await second.close();
  });

  it("stores datatypes and topic metadata", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "metadata" });
    await store.init();

    const datatypes: RosDatatypes = new Map([
      ["pkg/Msg", { definitions: [{ name: "value", type: "uint32" }] }],
    ]);
    await store.storeDatatypes(datatypes);
    await store.storeTopics(
      [
        {
          name: "/topic",
          schemaName: "pkg/Msg",
          messageEncoding: "cdr",
          schemaEncoding: "ros2msg",
          schemaData: new Uint8Array([1, 2, 3]),
        },
      ],
      new Map([["/topic", { numMessages: 3 }]]),
    );

    expect(await store.getDatatypes()).toEqual(datatypes);
    expect(await store.getTopics()).toEqual([
      {
        name: "/topic",
        schemaName: "pkg/Msg",
        messageEncoding: "cdr",
        schemaEncoding: "ros2msg",
        schemaData: new Uint8Array([1, 2, 3]),
        topicStats: { numMessages: 3 },
      },
    ]);

    await store.close();
  });

  it("clears sessions by kind without deleting other session kinds", async () => {
    const realtime = new IndexedDbMessageStore({ sessionId: "realtime", kind: "realtime-viz" });
    await realtime.init();
    await realtime.append([messageEvent(1)]);
    await realtime.flush();
    await realtime.close();

    const spill = new IndexedDbMessageStore({ sessionId: "spill", kind: "playback-spill" });
    await spill.init();
    await spill.append([messageEvent(2)]);
    await spill.flush();

    await spill.clearSessionsByKind("realtime-viz");

    const realtimeReader = new IndexedDbMessageStore({ sessionId: "realtime" });
    await realtimeReader.init();
    expect((await realtimeReader.stats()).count).toBe(0);
    expect((await spill.stats()).count).toBe(1);

    await realtimeReader.close();
    await spill.close();
  });

  it("drops v1 cache data during migration and remains writable", async () => {
    await IDB.deleteDB("studio-realtime-cache");

    const v1 = await IDB.openDB("studio-realtime-cache", 1, {
      upgrade(db) {
        const store = db.createObjectStore("messages", {
          keyPath: ["sessionId", "receiveTime.sec", "receiveTime.nsec", "seq"],
        });
        store.createIndex("bySessionTime", ["sessionId", "receiveTime.sec", "receiveTime.nsec"]);
        store.createIndex("bySessionTopicTime", [
          "sessionId",
          "topic",
          "receiveTime.sec",
          "receiveTime.nsec",
        ]);
        store.createIndex("bySession", "sessionId");
        db.createObjectStore("datatypes", { keyPath: "sessionId" });
        db.createObjectStore("sessions", { keyPath: "sessionId" });
      },
    });
    const tx = v1.transaction(["messages", "sessions"], "readwrite");
    await tx.objectStore("sessions").put({
      sessionId: "v1",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    await tx.objectStore("messages").put({
      ...messageEvent(1),
      sessionId: "v1",
      seq: 0,
    });
    await tx.done;
    v1.close();

    const store = new IndexedDbMessageStore({ sessionId: "v2" });
    await store.init();
    await store.append([messageEvent(2)]);
    await store.flush();

    expect((await store.stats()).count).toBe(1);

    const oldReader = new IndexedDbMessageStore({ sessionId: "v1" });
    await oldReader.init();
    expect((await oldReader.stats()).count).toBe(0);

    await oldReader.close();
    await store.close();
  });

  it("times out blocked initialization", async () => {
    await IDB.deleteDB("studio-realtime-cache");

    const blocker = await IDB.openDB("studio-realtime-cache", 1, {
      upgrade(db) {
        db.createObjectStore("blocker");
      },
    });

    const store = new IndexedDbMessageStore({ sessionId: "blocked", openTimeoutMs: 10 });

    await expect(store.init()).rejects.toThrow("Timed out opening IndexedDbMessageStore");
    (console.error as jest.Mock).mockClear();
    (console.warn as jest.Mock).mockClear();
    blocker.close();
  });

  it("bounds the append queue by dropping the oldest queued messages", async () => {
    const store = new IndexedDbMessageStore({
      sessionId: "bounded-queue",
      maxQueuedMessages: 2,
      openTimeoutMs: 1000,
    });

    await store.append([messageEvent(1), messageEvent(2), messageEvent(3)]);
    await store.init();
    await store.flush();

    const messages = await store.getMessages({
      start: { sec: 0, nsec: 0 },
      end: { sec: 20, nsec: 0 },
    });

    expect(messages.map((msg) => msg.message)).toEqual([{ seq: 2 }, { seq: 3 }]);
    (console.warn as jest.Mock).mockClear();
    await store.close();
  });
});
