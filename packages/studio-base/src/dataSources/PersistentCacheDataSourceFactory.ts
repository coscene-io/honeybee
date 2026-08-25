// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { IterablePlayer, WorkerIterableSource } from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";

class PersistentCacheDataSourceFactory implements IDataSourceFactory {
  public id = "persistent-cache";
  public type: IDataSourceFactory["type"] = "persistent-cache";
  public displayName = "test persistent cache";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = true;
  public description = "just for test persistent cache, not for production use";

  public formConfig = {
    fields: [
      {
        id: "sessionId",
        label: "sessionId",
        placeholder: "sessionId",
        validate: (newValue: string): Error | undefined => {
          // Session ID validation - can be empty or a valid session ID format
          if (newValue && !/^[a-zA-Z0-9\-_]+$/.test(newValue)) {
            return new Error("only letters, numbers, hyphens and underscores are allowed");
          }
          return undefined;
        },
      },
    ],
  };

  public async initialize(args: DataSourceFactoryInitializeArgs): Promise<Player | undefined> {
    try {
      // Extract parameters
      const sessionId = args.params?.sessionId ?? args.sessionId;
      const retentionWindowMs = args.retentionWindowMs;
      const maxCacheSize = args.maxCacheSize;

      if (sessionId == undefined) {
        console.error("sessionId is required for persistent cache source");
        return;
      }

      const source = new WorkerIterableSource({
        initWorker: () => {
          return new Worker(
            new URL(
              "@foxglove/studio-base/players/IterablePlayer/PersistentCache/PersistentCacheIterableSource.worker",
              import.meta.url,
            ),
          );
        },
        initArgs: {
          sessionId,
          retentionWindowMs,
          maxCacheSize,
        },
      });

      // IterablePlayer normally initializes after MessagePipeline installs its listener. Run the
      // real worker initialization now and reuse it so PlayerManager can recover before switching.
      await source.preinitialize();

      try {
        // Return a wrapper that handles initialization
        return new IterablePlayer({
          metricsCollector: args.metricsCollector,
          source,
          sourceId: this.id,
          urlParams: { sessionId },
          enablePlaybackSpillCache: false,
        });
      } catch (error) {
        try {
          await source.terminate();
        } catch (terminationError) {
          console.warn(
            "Failed to terminate initialized persistent cache source:",
            terminationError,
          );
        }
        throw error;
      }
    } catch (error) {
      console.error("Failed to initialize PersistentCacheDataSourceFactory:", error);
      throw error;
    }
  }
}

export default PersistentCacheDataSourceFactory;
