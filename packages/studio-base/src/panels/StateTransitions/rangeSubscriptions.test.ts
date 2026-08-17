// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MessageEvent } from "@foxglove/studio";
import type { SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import {
  planStateTransitionsSubscriptions,
  startStateTransitionsRangeSubscriptions,
} from "./rangeSubscriptions";
import type { StateTransitionPath } from "./types";

function path(value: string, options: Partial<StateTransitionPath> = {}): StateTransitionPath {
  return {
    enabled: true,
    timestampMethod: "receiveTime",
    value,
    ...options,
  };
}

describe("planStateTransitionsSubscriptions", () => {
  it("groups topics and unions value, filter, and header fields in stable order", () => {
    expect(
      planStateTransitionsSubscriptions({
        paths: [
          path("/vehicle{source==1}.mode"),
          path("/other.state"),
          path("/vehicle.status", { timestampMethod: "headerStamp" }),
        ],
        globalVariables: {},
      }),
    ).toEqual([
      {
        topic: "/vehicle",
        currentSubscription: {
          topic: "/vehicle",
          fields: ["mode", "source", "header", "status"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/vehicle",
          fields: ["mode", "source", "header", "status"],
          preloadType: "full",
        },
        rangePayload: { fields: ["mode", "source", "header", "status"] },
      },
      {
        topic: "/other",
        currentSubscription: {
          topic: "/other",
          fields: ["state"],
          preloadType: "partial",
        },
        fallbackSubscription: {
          topic: "/other",
          fields: ["state"],
          preloadType: "full",
        },
        rangePayload: { fields: ["state"] },
      },
    ]);
  });

  it("omits disabled, invalid, and property-less paths", () => {
    expect(
      planStateTransitionsSubscriptions({
        paths: [
          path("/disabled.value", { enabled: false }),
          path("not a path"),
          path("/topic-only"),
          path("/valid.value"),
        ],
        globalVariables: {},
      }).map((plan) => plan.topic),
    ).toEqual(["/valid"]);
  });

  it("resolves global variables and includes their filter fields", () => {
    expect(
      planStateTransitionsSubscriptions({
        paths: [path("/vehicles{id==$selected}.state")],
        globalVariables: { selected: 3 },
      })[0]?.rangePayload.fields,
    ).toEqual(["state", "id"]);
  });
});

type OnNewRangeIterator = Parameters<SubscribeMessageRange>[0]["onNewRangeIterator"];

function message(id: number): MessageEvent {
  return {
    topic: "/state",
    schemaName: "test",
    receiveTime: { sec: id, nsec: 0 },
    message: { id },
    sizeInBytes: 1,
  };
}

function statePlan() {
  return planStateTransitionsSubscriptions({
    paths: [path("/state.value")],
    globalVariables: {},
  })[0]!;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("startStateTransitionsRangeSubscriptions", () => {
  it("falls back per topic when range setup throws synchronously", () => {
    const subscribeMessageRange: SubscribeMessageRange = () => {
      throw new Error("unsupported");
    };
    const running = startStateTransitionsRangeSubscriptions({
      plans: [statePlan()],
      attemptRanges: true,
      subscribeMessageRange,
      generation: Promise.resolve(1),
      onIteratorStart: async () => undefined,
      onRangeBatch: async () => undefined,
    });

    expect(running.rangeTopics).toEqual(new Set());
    expect(running.subscriptions).toEqual([statePlan().fallbackSubscription]);
  });

  it("requests finite history and backpressures bounded 10k slices", async () => {
    let onNewRangeIterator: OnNewRangeIterator | undefined;
    const subscribeMessageRange = jest.fn<
      ReturnType<SubscribeMessageRange>,
      Parameters<SubscribeMessageRange>
    >((options) => {
      onNewRangeIterator = options.onNewRangeIterator;
      expect(options.receiveLiveData).toBe(false);
      expect(options.skipUserScripts).toBe(true);
      return () => undefined;
    });
    let releaseFirst!: () => void;
    const firstSliceBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sliceSizes: number[] = [];
    const running = startStateTransitionsRangeSubscriptions({
      plans: [statePlan()],
      attemptRanges: true,
      subscribeMessageRange,
      generation: Promise.resolve(3),
      onIteratorStart: async () => undefined,
      onRangeBatch: async (_topic, batch) => {
        sliceSizes.push(batch.length);
        if (sliceSizes.length === 1) {
          await firstSliceBlocked;
        }
      },
    });
    const batch = Array.from({ length: 25_001 }, (_, index) => message(index));
    const consume = onNewRangeIterator!(
      (async function* () {
        yield batch;
      })(),
    );

    await flushMicrotasks();
    expect(sliceSizes).toEqual([10_000]);
    releaseFirst();
    await consume;
    expect(sliceSizes).toEqual([10_000, 10_000, 5_001]);
    running.cancel();
  });

  it("resets replacement iterators and consumes only the latest replay", async () => {
    let onNewRangeIterator: OnNewRangeIterator | undefined;
    const subscribeMessageRange: SubscribeMessageRange = (options) => {
      onNewRangeIterator = options.onNewRangeIterator;
      return () => undefined;
    };
    let releaseOld!: () => void;
    const oldBlocked = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const starts: number[] = [];
    const batches: number[] = [];
    const running = startStateTransitionsRangeSubscriptions({
      plans: [statePlan()],
      attemptRanges: true,
      subscribeMessageRange,
      generation: Promise.resolve(5),
      onIteratorStart: async (_topic, generation) => {
        starts.push(generation);
      },
      onRangeBatch: async (_topic, batch) => {
        batches.push((batch[0]?.message as { id: number }).id);
      },
    });

    const oldConsume = onNewRangeIterator!(
      (async function* () {
        await oldBlocked;
        yield [message(1)];
      })(),
    );
    await flushMicrotasks();
    const newConsume = onNewRangeIterator!(
      (async function* () {
        yield [message(2)];
      })(),
    );
    await newConsume;
    releaseOld();
    await oldConsume;

    expect(starts).toEqual([5, 5]);
    expect(batches).toEqual([2]);
    running.cancel();
  });
});
