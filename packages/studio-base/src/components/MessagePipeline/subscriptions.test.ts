// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  makeSubscriptionMemoizer,
  mergeSubscriptions,
} from "@foxglove/studio-base/components/MessagePipeline/subscriptions";
import { SubscribePayload } from "@foxglove/studio-base/players/types";

describe("subscription identity", () => {
  it("reuses a subscription after switching fields and switching back", () => {
    const memoize = makeSubscriptionMemoizer();
    const original = memoize({ topic: "/points", fields: ["x", "y"], preloadType: "full" });
    const changed = memoize({ topic: "/points", fields: ["z"], preloadType: "full" });
    expect(changed).not.toBe(original);
    expect(memoize({ topic: "/points", fields: ["x", "y"], preloadType: "full" })).toBe(original);
  });

  it("does not share subscriptions between independent player scopes", () => {
    const first = makeSubscriptionMemoizer();
    const second = makeSubscriptionMemoizer();
    const subscription: SubscribePayload = { topic: "/points", preloadType: "partial" };
    expect(first(subscription)).toBe(subscription);
    expect(second({ ...subscription })).not.toBe(subscription);
    expect(first({ ...subscription, preloadType: "full" })).not.toBe(subscription);
  });
});

describe("mergeSubscriptions", () => {
  it("combines full and partial subscriptions", () => {
    const subs: SubscribePayload[] = [
      { topic: "a", preloadType: "full" },
      { topic: "a", preloadType: "partial" },
    ];

    const result = mergeSubscriptions(subs);

    expect(result).toEqual([
      { topic: "a", preloadType: "full" },
      { topic: "a", preloadType: "partial" },
    ]);
  });

  it("combines full and partial and sliced subscriptions", () => {
    const subs: SubscribePayload[] = [
      { topic: "a", preloadType: "full" },
      { topic: "a", preloadType: "partial" },
      { topic: "a", preloadType: "partial", fields: ["one", "two"] },
    ];

    const result = mergeSubscriptions(subs);

    expect(result).toEqual([
      { topic: "a", preloadType: "full" },
      { topic: "a", preloadType: "partial" },
    ]);
  });

  it("excludes empty slices", () => {
    const subs: SubscribePayload[] = [
      { topic: "b", preloadType: "full", fields: ["one", "two"] },
      { topic: "b", preloadType: "partial", fields: ["one", "two", "three"] },
      { topic: "c", preloadType: "partial", fields: [] },
    ];

    const result = mergeSubscriptions(subs);

    expect(result).toEqual([
      { topic: "b", preloadType: "full", fields: ["one", "two"] },
      { topic: "b", preloadType: "partial", fields: ["one", "two", "three"] },
    ]);
  });

  it("switches to subscribing to all fields", () => {
    const subs: SubscribePayload[] = [
      { topic: "a", preloadType: "partial", fields: ["one", "two"] },
      { topic: "a", preloadType: "full", fields: ["one", "two"] },
      { topic: "a", preloadType: "partial" },
    ];

    const result = mergeSubscriptions(subs);

    expect(result).toEqual([
      { topic: "a", preloadType: "full", fields: ["one", "two"] },
      { topic: "a", preloadType: "partial" },
    ]);
  });

  it("switches to subscribing to all fields across preloadType", () => {
    const subs: SubscribePayload[] = [
      { topic: "a", preloadType: "partial", fields: ["one", "two"] },
      { topic: "a", preloadType: "full" },
    ];

    const result = mergeSubscriptions(subs);

    expect(result).toEqual([
      { topic: "a", preloadType: "full" },
      { topic: "a", preloadType: "partial" },
    ]);
  });
});
