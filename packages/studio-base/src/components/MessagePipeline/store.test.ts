// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { RefObject } from "react";

import type { Player, SubscribeMessageRangeArgs } from "@foxglove/studio-base/players/types";
import type { IUrdfStorage } from "@foxglove/studio-base/services/IUrdfStorage";
import type { S3FileService } from "@foxglove/studio-base/services/S3FileService";

import type { FramePromise } from "./pauseFrameForPromise";
import { createMessagePipelineStore } from "./store";

describe("MessagePipeline store", () => {
  it("preserves the player binding when subscribing message ranges", () => {
    const unsubscribe = jest.fn();
    let called = false;
    const player = {
      subscribeMessageRange(this: Player, args: SubscribeMessageRangeArgs) {
        called = true;
        expect(this).toBe(player);
        expect(args.topic).toBe("/camera");
        return unsubscribe;
      },
    } as unknown as Player;

    const store = createMessagePipelineStore({
      promisesToWaitForRef: { current: [] } as RefObject<FramePromise[]>,
      initialPlayer: player,
      urdfStorage: {} as IUrdfStorage,
      s3FileService: {} as S3FileService,
    });

    const result = store.getState().public.subscribeMessageRange?.({
      topic: "/camera",
      timeRange: { start: { sec: 0, nsec: 0 }, end: { sec: 1, nsec: 0 } },
      onNewRangeIterator: jest.fn(),
    });

    expect(result).toBe(unsubscribe);
    expect(called).toBe(true);
  });
});
