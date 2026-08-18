// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Player, SubscribeMessageRangeArgs } from "@foxglove/studio-base/players/types";
import type { IUrdfStorage } from "@foxglove/studio-base/services/IUrdfStorage";
import type { S3FileService } from "@foxglove/studio-base/services/S3FileService";

import { createMessagePipelineStore } from "./store";

describe("MessagePipeline store", () => {
  it("preserves the player binding when subscribing message ranges", () => {
    const unsubscribe = jest.fn();
    let called = false;
    let receivedArgs: SubscribeMessageRangeArgs | undefined;
    const player = {
      subscribeMessageRange(this: Player, args: SubscribeMessageRangeArgs) {
        called = true;
        receivedArgs = args;
        expect(this).toBe(player);
        expect(args.topic).toBe("/camera");
        return unsubscribe;
      },
    } as unknown as Player;

    const store = createMessagePipelineStore({
      promisesToWaitForRef: { current: [] },
      initialPlayer: player,
      urdfStorage: {} as IUrdfStorage,
      s3FileService: {} as S3FileService,
    });

    const rangeArgs: SubscribeMessageRangeArgs = {
      topic: "/camera",
      payload: { fields: ["header", "data"] },
      receiveLiveData: true,
      skipUserScripts: true,
      onNewRangeIterator: jest.fn(),
    };
    const result = store.getState().public.subscribeMessageRange?.(rangeArgs);

    expect(result).toBe(unsubscribe);
    expect(called).toBe(true);
    expect(receivedArgs).toBe(rangeArgs);
    expect(receivedArgs).not.toHaveProperty("timeRange");
  });

  it("keeps range subscriptions working after a player-switch reset", () => {
    const unsubscribe = jest.fn();
    const subscribeMessageRange = jest.fn(() => unsubscribe);
    const player = {
      subscribeMessageRange,
    } as unknown as Player;

    const store = createMessagePipelineStore({
      promisesToWaitForRef: { current: [] },
      initialPlayer: player,
      urdfStorage: {} as IUrdfStorage,
      s3FileService: {} as S3FileService,
    });

    // reset() runs when the playerId changes (e.g. opening another recording). Unlike the
    // playback controls, which the reducer rebinds from capabilities on the next player state,
    // subscribeMessageRange is a closure over the current player and must survive the reset.
    store.getState().reset();

    const rangeArgs: SubscribeMessageRangeArgs = {
      topic: "/camera",
      payload: { fields: ["header"] },
      receiveLiveData: false,
      skipUserScripts: true,
      onNewRangeIterator: jest.fn(),
    };
    const result = store.getState().public.subscribeMessageRange?.(rangeArgs);

    expect(result).toBe(unsubscribe);
    expect(subscribeMessageRange).toHaveBeenCalledTimes(1);
  });

  it("waits for close before reopening and coalesces reopen requests", async () => {
    let resolveClose: (() => void) | undefined;
    const close = jest.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveClose = resolve;
      });
    });
    const reOpen = jest.fn();
    const player = {
      close,
      reOpen,
    } as unknown as Player;
    const store = createMessagePipelineStore({
      promisesToWaitForRef: { current: [] },
      initialPlayer: player,
      urdfStorage: {} as IUrdfStorage,
      s3FileService: {} as S3FileService,
    });

    store.getState().public.close();
    store.getState().public.reOpen();
    store.getState().public.reOpen();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(reOpen).not.toHaveBeenCalled();

    resolveClose?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(reOpen).toHaveBeenCalledTimes(1);
  });

  it("lets a later close cancel a pending reopen", async () => {
    let resolveClose: (() => void) | undefined;
    const close = jest.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveClose = resolve;
      });
    });
    const reOpen = jest.fn();
    const player = {
      close,
      reOpen,
    } as unknown as Player;
    const store = createMessagePipelineStore({
      promisesToWaitForRef: { current: [] },
      initialPlayer: player,
      urdfStorage: {} as IUrdfStorage,
      s3FileService: {} as S3FileService,
    });

    store.getState().public.close();
    store.getState().public.reOpen();
    store.getState().public.close();
    await Promise.resolve();
    resolveClose?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(reOpen).not.toHaveBeenCalled();
  });
});
