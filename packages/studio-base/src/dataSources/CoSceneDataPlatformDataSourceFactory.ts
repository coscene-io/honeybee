// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";

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

const initWorkers: Record<string, () => Worker> = {
  ".bag": () => {
    return new Worker(
      new URL(
        "@foxglove/studio-base/players/IterablePlayer/BagIterableSourceWorker.worker",
        import.meta.url,
      ),
    );
  },
  ".mcap": () => {
    return new Worker(
      new URL(
        "@foxglove/studio-base/players/IterablePlayer/Mcap/McapIterableSourceWorker.worker",
        import.meta.url,
      ),
    );
  },
};

class CoSceneDataPlatformDataSourceFactory implements IDataSourceFactory {
  public id = "coscene-data-platform";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Coscene Data Platform";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = false;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const consoleApi = args.consoleApi;
    const url = args.params?.url;
    if (!consoleApi) {
      return;
    }

    if (!url) {
      throw new Error("Missing url argument");
    }

    const extension = path.extname(new URL(url).pathname);
    const initWorker = initWorkers[extension];
    if (!initWorker) {
      throw new Error(`Unsupported extension: ${extension}`);
    }

    const source = new WorkerIterableSource({
      sourceType: "foxgloveDataPlatform",
      initWorker,
      initArgs: {
        api: {
          baseUrl: APP_CONFIG.CS_HONEYBEE_BASE_URL,
          auth: `${localStorage.getItem("coScene_org_jwt")}`,
        },
        params: args.params,
        coSceneContext: JSON.parse(localStorage.getItem("CoSceneContext") ?? "{}"),
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
    });
  }
}

export default CoSceneDataPlatformDataSourceFactory;
