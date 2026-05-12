// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  clearIndexedDbMessageStoreDatabase,
  IndexedDbMessageStore,
} from "@foxglove/studio-base/persistence/IndexedDbMessageStore";

import { PersistentCacheIterableSource } from "./PersistentCacheIterableSource";

describe("PersistentCacheIterableSource", () => {
  beforeEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  afterEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  it("initializes topics and datatypes from metadata", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "source-metadata" });
    await store.init();
    await store.storeDatatypes(
      new Map([["pkg/Msg", { definitions: [{ name: "value", type: "uint32" }] }]]),
    );
    await store.storeTopics(
      [{ name: "/late_topic", schemaName: "pkg/Msg" }],
      new Map([["/late_topic", { numMessages: 1 }]]),
    );
    await store.append([
      {
        topic: "/other",
        schemaName: "pkg/Msg",
        receiveTime: { sec: 1, nsec: 0 },
        message: {},
        sizeInBytes: 1,
      },
    ]);
    await store.flush();
    await store.close();

    const source = new PersistentCacheIterableSource({ sessionId: "source-metadata" });
    const init = await source.initialize();

    expect(init.topics).toEqual([{ name: "/late_topic", schemaName: "pkg/Msg" }]);
    expect(init.topicStats).toEqual(new Map([["/late_topic", { numMessages: 1 }]]));
    expect(init.datatypes).toEqual(
      new Map([["pkg/Msg", { definitions: [{ name: "value", type: "uint32" }] }]]),
    );

    await source.terminate();
  });

  it("does not delete the cache session on terminate", async () => {
    const store = new IndexedDbMessageStore({ sessionId: "readonly-terminate" });
    await store.init();
    await store.storeDatatypes(new Map([["pkg/Msg", { definitions: [] }]]));
    await store.storeTopics([{ name: "/topic", schemaName: "pkg/Msg" }]);
    await store.append([
      {
        topic: "/topic",
        schemaName: "pkg/Msg",
        receiveTime: { sec: 1, nsec: 0 },
        message: { value: 1 },
        sizeInBytes: 1,
      },
    ]);
    await store.flush();
    await store.close();

    const source = new PersistentCacheIterableSource({ sessionId: "readonly-terminate" });
    await source.initialize();
    await source.terminate();

    const reader = new IndexedDbMessageStore({ sessionId: "readonly-terminate" });
    await reader.init();
    expect((await reader.stats()).count).toBe(1);
    await reader.close();
  });
});
