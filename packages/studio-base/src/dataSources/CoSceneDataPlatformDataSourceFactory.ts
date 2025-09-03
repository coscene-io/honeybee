// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { IterablePlayer, WorkerIterableSource } from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";

class CoSceneDataPlatformDataSourceFactory implements IDataSourceFactory {
  public id = "coscene-data-platform";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = t("openDialog:coSceneDataPlatform");
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = false;
  public description = t("openDialog:coSceneDataPlatformDesc");
  public needLogin = true;

  public formConfig = {
    fields: [
      {
        id: "url",
        label: t("openDialog:dataPlatformUrl"),
        placeholder: `https://${APP_CONFIG.DOMAIN_CONFIG.default?.webDomain}/viz?ds=coscene-data-platform&ds.key=example_key`,
        validate: (newValue: string): Error | undefined => {
          try {
            const url = new URL(newValue);
            if (url.hostname !== APP_CONFIG.DOMAIN_CONFIG.default?.webDomain) {
              return new Error(
                t("openDialog:onlySupportDomain", {
                  domain: APP_CONFIG.DOMAIN_CONFIG.default?.webDomain,
                }),
              );
            }
            if (url.pathname !== "/viz") {
              return new Error(t("openDialog:urlPathnameMustBeViz"));
            }

            const parsedUrl = parseAppURLState(url);
            if (parsedUrl?.ds !== "coscene-data-platform") {
              return new Error(t("openDialog:dataSourceMustBeCosSceneDataPlatform"));
            }

            if (parsedUrl.dsParams?.key == undefined) {
              return new Error(t("openDialog:dataSourceParamsKeyIsRequired"));
            }

            return undefined;
          } catch {
            return new Error(t("openDialog:enterAValidUrl"));
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

    const baseUrl = consoleApi.getBaseUrl();
    const bffUrl = consoleApi.getBffUrl();
    const auth = consoleApi.getAuthHeader();
    const baseInfo = consoleApi.getApiBaseInfo();
    const timeMode = consoleApi.getTimeMode();

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
          timeMode,
          auth,
        },
        params: { ...args.params, ...baseInfo },
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

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      sourceId: this.id,
      urlParams: definedParams,
    });
  }
}

export default CoSceneDataPlatformDataSourceFactory;
