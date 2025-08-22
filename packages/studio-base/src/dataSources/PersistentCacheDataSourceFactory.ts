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
      const sessionId = args.params?.sessionId;

      if (sessionId == undefined) {
        console.error("sessionId is required for persistent cache source");
        return;
      }

      const source = new WorkerIterableSource({
        initWorker: () => {
          // foxglove-depcheck-used: babel-plugin-transform-import-meta
          return new Worker(
            new URL(
              "@foxglove/studio-base/players/IterablePlayer/PersistentCache/PersistentCacheIterableSource.worker",
              import.meta.url,
            ),
          );
        },
        initArgs: {
          sessionId,
        },
      });

      // Return a wrapper that handles initialization
      return new IterablePlayer({
        metricsCollector: args.metricsCollector,
        source,
        sourceId: this.id,
        urlParams: { sessionId },
      });
    } catch (error) {
      console.error("Failed to initialize PersistentCacheDataSourceFactory:", error);
      return undefined;
    }
  }
}

export default PersistentCacheDataSourceFactory;
