// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import type { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import { PersistentCachePlayer } from "@foxglove/studio-base/players/PersistentCachePlayer";
import {
  AdvertiseOptions,
  PlaybackSpeed,
  Player,
  PlayerPresence,
  PlayerState,
  PublishPayload,
  SubscribePayload,
} from "@foxglove/studio-base/players/types";

class PersistentCacheDataSourceFactory implements IDataSourceFactory {
  public id = "persistent-cache";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "缓存数据回放";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = false;
  public description = "播放存储在本地IndexedDB中的实时数据缓存";

  public formConfig = {
    fields: [
      {
        id: "sessionId",
        label: "会话ID (可选)",
        placeholder: "留空自动选择最新会话",
        validate: (newValue: string): Error | undefined => {
          // Session ID validation - can be empty or a valid session ID format
          if (newValue && !/^[a-zA-Z0-9\-_]+$/.test(newValue)) {
            return new Error("会话ID只能包含字母、数字、连字符和下划线");
          }
          return undefined;
        },
      },
      {
        id: "name",
        label: "播放器名称 (可选)",
        placeholder: "缓存数据回放",
        validate: undefined,
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    try {
      // Extract parameters
      const sessionId = args.params?.sessionId ?? undefined;
      const name = args.params?.name ?? "缓存数据回放";

      // Create the persistent cache player
      const cachePlayer = new PersistentCachePlayer({
        metricsCollector: args.metricsCollector,
        sessionId,
        name,
        sourceId: this.id,
        urlParams: args.params
          ? (Object.fromEntries(
              Object.entries(args.params).filter(([, v]) => v != undefined),
            ) as Record<string, string>)
          : undefined,
        enablePreload: true,
      });

      // Return a wrapper that handles initialization
      return new PersistentCachePlayerWrapper(cachePlayer);
    } catch (error) {
      console.error("Failed to initialize PersistentCacheDataSourceFactory:", error);
      return undefined;
    }
  }
}

/**
 * Wrapper class that implements the Player interface and handles
 * asynchronous initialization of the PersistentCachePlayer
 */
class PersistentCachePlayerWrapper implements Player {
  #cachePlayer: PersistentCachePlayer;
  #actualPlayer?: Player;
  #listener?: (playerState: PlayerState) => Promise<void>;
  #initError?: Error;

  public constructor(cachePlayer: PersistentCachePlayer) {
    this.#cachePlayer = cachePlayer;
    void this.#initialize();
  }

  async #initialize(): Promise<void> {
    try {
      this.#actualPlayer = await this.#cachePlayer.initialize();

      // If a listener was set before initialization, set it on the actual player
      if (this.#listener) {
        this.#actualPlayer.setListener(this.#listener);
      }
    } catch (error) {
      this.#initError = error as Error;
      console.error("Failed to initialize persistent cache player:", error);

      // Emit error state to listener if available
      if (this.#listener) {
        await this.#listener({
          name: "缓存数据回放",
          presence: PlayerPresence.ERROR,
          progress: {},
          capabilities: [],
          profile: undefined,
          playerId: "persistent-cache-error",
          activeData: undefined,
          problems: [
            {
              severity: "error",
              message: `初始化缓存播放器失败: ${error.message}`,
            },
          ],
          urlState: {
            sourceId: "persistent-cache",
            parameters: undefined,
          },
        });
      }
    }
  }

  public setListener(listener: (playerState: PlayerState) => Promise<void>): void {
    this.#listener = listener;

    // If already initialized, set listener on actual player
    if (this.#actualPlayer) {
      this.#actualPlayer.setListener(listener);
    } else if (!this.#initError) {
      // Still initializing, emit initializing state
      void listener({
        name: "缓存数据回放",
        presence: PlayerPresence.INITIALIZING,
        progress: {},
        capabilities: [],
        profile: undefined,
        playerId: "persistent-cache-init",
        activeData: undefined,
        problems: [],
        urlState: {
          sourceId: "persistent-cache",
          parameters: undefined,
        },
      });
    }
  }

  public startPlayback(): void {
    this.#actualPlayer?.startPlayback?.();
  }

  public playUntil(time: import("@foxglove/rostime").Time): void {
    this.#actualPlayer?.playUntil?.(time);
  }

  public pausePlayback(): void {
    this.#actualPlayer?.pausePlayback?.();
  }

  public setPlaybackSpeed(speed: PlaybackSpeed): void {
    this.#actualPlayer?.setPlaybackSpeed?.(speed);
  }

  // eslint-disable-next-line @foxglove/no-boolean-parameters
  public enableRepeatPlayback(enable: boolean): void {
    this.#actualPlayer?.enableRepeatPlayback?.(enable);
  }

  public seekPlayback(time: import("@foxglove/rostime").Time): void {
    this.#actualPlayer?.seekPlayback?.(time);
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this.#actualPlayer?.setSubscriptions(subscriptions);
  }

  public setPublishers(publishers: AdvertiseOptions[]): void {
    this.#actualPlayer?.setPublishers(publishers);
  }

  public setParameter(key: string, value: import("@foxglove/studio").ParameterValue): void {
    this.#actualPlayer?.setParameter(key, value);
  }

  public publish(payload: PublishPayload): void {
    this.#actualPlayer?.publish(payload);
  }

  public async callService(serviceName: string, request: unknown): Promise<unknown> {
    if (this.#actualPlayer) {
      return await this.#actualPlayer.callService(serviceName, request);
    }
    throw new Error("播放器尚未初始化");
  }

  public close(): void {
    this.#actualPlayer?.close();
    void this.#cachePlayer.close();
  }

  public setGlobalVariables(globalVariables: GlobalVariables): void {
    this.#actualPlayer?.setGlobalVariables(globalVariables);
  }

  public getMetadata(): ReadonlyArray<Readonly<import("@foxglove/studio").Metadata>> {
    return this.#actualPlayer?.getMetadata?.() ?? [];
  }

  public reOpen(): void {
    this.#actualPlayer?.reOpen();
  }
}

export default PersistentCacheDataSourceFactory;
