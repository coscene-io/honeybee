// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/CoScenePlayerSelectionContext";
import {
  CoSceneIterablePlayer,
  WorkerIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";

class CoSceneDataPlatformDataSourceFactory implements IDataSourceFactory {
  public id = "coscene-data-platform";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Coscene Data Platform";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = false;
  public description = "this is a description";
  #readAheadDuration = { sec: 20, nsec: 0 };

  public constructor() {
    const readAheadDuration = localStorage.getItem("readAheadDuration");
    if (readAheadDuration && !isNaN(+readAheadDuration)) {
      this.#readAheadDuration = { sec: +readAheadDuration, nsec: 0 };
    }
  }

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "Data Platform URL",
        placeholder: `https://${APP_CONFIG.DOMAIN_CONFIG.default?.webDomain}/viz?ds=coscene-data-platform&ds.key=example_key`,
        validate: (newValue: string): Error | undefined => {
          try {
            const url = new URL(newValue);
            if (url.hostname !== APP_CONFIG.DOMAIN_CONFIG.default?.webDomain) {
              return new Error(
                `Only support domain https://${APP_CONFIG.DOMAIN_CONFIG.default?.webDomain} now`,
              );
            }
            if (url.pathname !== "/viz") {
              return new Error(`url pathname must be /viz`);
            }

            const parsedUrl = parseAppURLState(url);
            if (parsedUrl?.ds !== "coscene-data-platform") {
              return new Error(`data source must type error`);
            }

            if (parsedUrl.dsParams?.key == undefined) {
              return new Error(`data source params key is required`);
            }

            return undefined;
          } catch {
            return new Error("Enter a valid url");
          }
        },
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const consoleApi = args.consoleApi;
    if (!consoleApi) {
      console.error("coscene-data-platform initialize: consoleApi is undefined");
      return;
    }
    // TODO: move to selectSource, 单独播放， 前缀， 时间模式, 预读取时间
    const singleRequestTime = localStorage.getItem("singleRequestTime");

    const baseUrl = consoleApi.getBaseUrl();
    const bffUrl = consoleApi.getBffUrl();
    const auth = consoleApi.getAuthHeader();
    const baseInfo = consoleApi.getApiBaseInfo();

    const source = new WorkerIterableSource({
      initWorker: () => {
        // foxglove-depcheck-used: babel-plugin-transform-import-meta
        return new Worker(
          new URL(
            "@foxglove/studio-base/players/IterablePlayer/coScene-data-platform/DataPlatformIterableSource.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: {
        api: {
          baseUrl,
          bffUrl,
          // TODO: move to selectSource
          addTopicPrefix:
            localStorage.getItem("CoScene_addTopicPrefix") ??
            APP_CONFIG.DEFAULT_TOPIC_PREFIX_OPEN[window.location.hostname] ??
            "false",
          timeMode:
            localStorage.getItem("CoScene_timeMode") === "relativeTime"
              ? "relativeTime"
              : "absoluteTime",
          auth,
        },
        params: { ...args.params, ...baseInfo, files: JSON.stringify(baseInfo.files) },
        singleRequestTime: singleRequestTime && !isNaN(+singleRequestTime) ? +singleRequestTime : 5,
      },
    });

    const definedParams: Record<string, string> = {};
    if (args.params) {
      for (const [key, value] of Object.entries(args.params)) {
        if (value != undefined) {
          definedParams[key] = value;
        }
      }
    }

    return new CoSceneIterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      sourceId: this.id,
      urlParams: definedParams,
      readAheadDuration: this.#readAheadDuration,
    });
  }
}

export default CoSceneDataPlatformDataSourceFactory;
