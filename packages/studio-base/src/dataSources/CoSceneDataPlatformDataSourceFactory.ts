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

class CoSceneDataPlatformDataSourceFactory implements IDataSourceFactory {
  public id = "coscene-data-platform";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Coscene Data Platform";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = false;
  #readAheadDuration = { sec: 30, nsec: 0 };

  public constructor() {
    const readAheadDuration = localStorage.getItem("readAheadDuration");
    if (readAheadDuration && !isNaN(+readAheadDuration)) {
      this.#readAheadDuration = { sec: +readAheadDuration, nsec: 0 };
    }
  }

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const consoleApi = args.consoleApi;
    if (!consoleApi) {
      console.error("coscene-data-platform initialize: consoleApi is undefined");
      return;
    }
    const singleRequestTime = localStorage.getItem("singleRequestTime");

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
          baseUrl: APP_CONFIG.CS_HONEYBEE_BASE_URL,
          bffUrl: APP_CONFIG.VITE_APP_BFF_URL,
          addTopicPrefix:
            localStorage.getItem("CoScene_addTopicPrefix") ??
            APP_CONFIG.DEFAULT_TOPIC_PREFIX_OPEN[window.location.hostname] ??
            "false",
          timeMode:
            localStorage.getItem("CoScene_timeMode") === "relativeTime"
              ? "relativeTime"
              : "absoluteTime",
          auth: `${localStorage.getItem("coScene_org_jwt")}`,
        },
        params: args.params,
        coSceneContext: JSON.parse(localStorage.getItem("CoSceneContext") ?? "{}"),
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
