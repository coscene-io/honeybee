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

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const consoleApi = args.consoleApi;
    if (!consoleApi) {
      return;
    }

    const source = new WorkerIterableSource({
      sourceType: "foxgloveDataPlatform",
      initArgs: {
        api: {
          baseUrl: APP_CONFIG.CS_HONEYBEE_BASE_URL,
          auth: `Bearer ${localStorage.getItem("coScene_org_jwt")}`,
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