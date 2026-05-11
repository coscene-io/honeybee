// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";

import {
  getReadAheadDurationDefaultTime,
  getRequestWindowDefaultTime,
} from "@foxglove/studio-base/constants/appSettingsDefaults";
import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  IterablePlayer,
  WorkerIterableSource,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";
import { getAppConfig, getDomainConfig } from "@foxglove/studio-base/util/appConfig";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";

const RAW_PROFILE = "raw";
const SHARD_MODE_PARAM = "shardMode";
const SHARD_MODE_MANIFEST = "manifest";
const SHARD_MODE_RAW = "raw";
const MANIFEST_URL_PARAM = "manifestUrl";

function definedUrlParams(params?: Record<string, string | undefined>): Record<string, string> {
  const definedParams: Record<string, string> = {};
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != undefined) {
        definedParams[key] = value;
      }
    }
  }
  return definedParams;
}

function buildManifestUrl(
  objectStorageBaseUrl: string,
  projectId: string,
  recordId: string,
): string {
  return `${objectStorageBaseUrl.replace(
    /\/+$/,
    "",
  )}/projects/${projectId}/records/${recordId}/manifest.json`;
}

async function manifestExists(manifestUrl: string): Promise<boolean> {
  try {
    const response = await fetch(manifestUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

class CoSceneDataPlatformDataSourceFactory implements IDataSourceFactory {
  public id = "coscene-data-platform";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = t("openDialog:coSceneDataPlatform");
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = false;
  public description = t("openDialog:coSceneDataPlatformDesc");
  public needLogin = true;

  #domainConfig = getDomainConfig();

  public formConfig = {
    fields: [
      {
        id: "url",
        label: t("openDialog:dataPlatformUrl"),
        placeholder: `https://${
          this.#domainConfig.webDomain
        }/viz?ds=coscene-data-platform&ds.key=example_key`,
        validate: (newValue: string): Error | undefined => {
          try {
            const url = new URL(newValue);
            if (url.hostname !== this.#domainConfig.webDomain) {
              return new Error(
                t("openDialog:onlySupportDomain", {
                  domain: this.#domainConfig.webDomain,
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

  public async initialize(args: DataSourceFactoryInitializeArgs): Promise<Player | undefined> {
    const consoleApi = args.consoleApi;

    if (!consoleApi) {
      console.error("coscene-data-platform initialize: consoleApi is undefined");
      return;
    }

    const objectStorageBaseUrl = getAppConfig().OBJECT_STORAGE_BASE_URL;
    const { projectId, recordId } = consoleApi.getApiBaseInfo();
    if (!objectStorageBaseUrl || !projectId || !recordId) {
      return this.#createDataPlatformPlayer(args);
    }

    const manifestUrl = buildManifestUrl(objectStorageBaseUrl, projectId, recordId);
    if (args.params?.profile === RAW_PROFILE) {
      return this.#createDataPlatformPlayer(args, manifestUrl);
    }

    if (await manifestExists(manifestUrl)) {
      // Manifest playback reads directly from object storage and is intentionally
      // not subject to the OUTBOUND_TRAFFIC entitlement check for now.
      return this.#createShardManifestPlayer(args, manifestUrl);
    }

    return this.#createDataPlatformPlayer(args);
  }

  #createDataPlatformPlayer(
    args: DataSourceFactoryInitializeArgs,
    manifestUrl?: string,
  ): Player | undefined {
    const consoleApi = args.consoleApi;
    const requestWindow = args.requestWindow ?? getRequestWindowDefaultTime();
    const readAheadDuration = args.readAheadDuration ?? getReadAheadDurationDefaultTime();

    if (!consoleApi) {
      console.error("coscene-data-platform initialize: consoleApi is undefined");
      return;
    }

    if (args.checkOutboundTrafficEntitlement?.() === false) {
      return;
    }

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
          auth,
        },
        params: { ...args.params, ...baseInfo },
        requestWindow,
      },
    });

    const urlParams = definedUrlParams(args.params);
    if (args.params?.profile === RAW_PROFILE && manifestUrl != undefined) {
      urlParams[SHARD_MODE_PARAM] = SHARD_MODE_RAW;
      urlParams[MANIFEST_URL_PARAM] = manifestUrl;
    }

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      sourceId: this.id,
      urlParams,
      readAheadDuration,
    });
  }

  #createShardManifestPlayer(
    args: DataSourceFactoryInitializeArgs,
    manifestUrl: string,
  ): Player | undefined {
    const profile = args.params?.profile;
    const params: Record<string, string> = { url: manifestUrl };
    if (profile != undefined) {
      params.profile = profile;
    }

    const source = new WorkerSerializedIterableSource({
      initWorker: () => {
        // foxglove-depcheck-used: babel-plugin-transform-import-meta
        return new Worker(
          new URL(
            "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/ShardManifestIterableSource.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: { params },
    });

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      sourceId: this.id,
      urlParams: {
        ...definedUrlParams(args.params),
        [SHARD_MODE_PARAM]: SHARD_MODE_MANIFEST,
        [MANIFEST_URL_PARAM]: manifestUrl,
      },
      readAheadDuration: { sec: 10, nsec: 0 },
      name: profile ? `Shard manifest (${profile})` : "Shard manifest",
    });
  }
}

export default CoSceneDataPlatformDataSourceFactory;
