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
import { IterablePlayer, WorkerIterableSource } from "@foxglove/studio-base/players/IterablePlayer";
import {
  findMatchingShardProfilePreference,
  loadShardProfilePreference,
  manifestProfileOptions,
  RAW_PROFILE,
} from "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/profilePreference";
import type {
  ManifestProfile,
  ShardProfileOption,
} from "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/profilePreference";
import { Player } from "@foxglove/studio-base/players/types";
import {
  getAppConfig,
  getDomainConfig,
  getWebBasePathname,
} from "@foxglove/studio-base/util/appConfig";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";
import {
  MANIFEST_URL_PARAM,
  SHARD_MODE_RAW,
  SHARD_MODE_PARAM,
} from "@foxglove/studio-base/util/shardManifestUrlParams";

import {
  createShardManifestPlayer,
  definedUrlParams,
  stableJsonStringify,
} from "./createShardManifestPlayer";
import { buildManifestUrl, getManifestStorageBaseUrl, manifestExists } from "./manifestStorage";

export { buildManifestUrl } from "./manifestStorage";

interface MinimalManifest {
  profiles?: ManifestProfile[];
}

async function fetchShardProfileOptions(manifestUrl: string): Promise<ShardProfileOption[]> {
  try {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      return [];
    }
    const manifest = (await response.json()) as MinimalManifest;
    return manifestProfileOptions(manifest.profiles ?? []);
  } catch {
    return [];
  }
}

function withProfile(
  args: DataSourceFactoryInitializeArgs,
  profile: string | undefined,
): DataSourceFactoryInitializeArgs {
  if (profile == undefined) {
    return args;
  }
  return { ...args, params: { ...args.params, profile } };
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
  #webBasePathname = getWebBasePathname();

  public formConfig = {
    fields: [
      {
        id: "url",
        label: t("openDialog:dataPlatformUrl"),
        placeholder: `https://${
          this.#domainConfig.webDomain
        }${this.#webBasePathname}?ds=coscene-data-platform&ds.key=example_key`,
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
            if (url.pathname !== this.#webBasePathname) {
              return new Error(
                t("openDialog:urlPathnameMustBeViz", { path: this.#webBasePathname }),
              );
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

    const objectStorageBaseUrl = getManifestStorageBaseUrl(
      args.manifestStorageSource,
      getAppConfig().OBJECT_STORAGE_BASE_URL,
    );
    const { projectId, recordId } = consoleApi.getApiBaseInfo();
    if (!objectStorageBaseUrl || !projectId || !recordId) {
      return this.#createDataPlatformPlayer(args);
    }

    const manifestUrl = buildManifestUrl(objectStorageBaseUrl, projectId, recordId);
    const requestedProfile = args.params?.profile;
    if (requestedProfile === RAW_PROFILE) {
      return this.#createDataPlatformPlayer(args, manifestUrl);
    }

    if (await manifestExists(manifestUrl)) {
      const profile = await this.#resolveManifestProfile(manifestUrl, requestedProfile);
      if (profile === RAW_PROFILE) {
        return this.#createDataPlatformPlayer(withProfile(args, profile), manifestUrl);
      }
      // Manifest playback reads directly from object storage and is intentionally
      // not subject to the OUTBOUND_TRAFFIC entitlement check for now.
      return this.#createShardManifestPlayer(withProfile(args, profile), manifestUrl);
    }

    return this.#createDataPlatformPlayer(args);
  }

  async #resolveManifestProfile(
    manifestUrl: string,
    requestedProfile: string | undefined,
  ): Promise<string | undefined> {
    const preference = loadShardProfilePreference();
    if (requestedProfile == undefined && preference?.value === RAW_PROFILE) {
      return RAW_PROFILE;
    }
    if (preference == undefined && requestedProfile != undefined) {
      return requestedProfile;
    }
    if (preference == undefined) {
      return undefined;
    }

    const options = await fetchShardProfileOptions(manifestUrl);
    if (
      requestedProfile != undefined &&
      options.some((option) => option.value === requestedProfile)
    ) {
      return requestedProfile;
    }

    return findMatchingShardProfilePreference(options, preference)?.value ?? requestedProfile;
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
    const playbackSpillCacheSourceKey = stableJsonStringify({
      sourceId: this.id,
      baseUrl,
      bffUrl,
      params: { ...args.params, ...baseInfo },
      manifestUrl,
    });

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
      enablePlaybackSpillCache: true,
      playbackSpillCacheSourceKey,
    });
  }

  #createShardManifestPlayer(
    args: DataSourceFactoryInitializeArgs,
    manifestUrl: string,
  ): Player | undefined {
    const profile = args.params?.profile;
    return createShardManifestPlayer({
      metricsCollector: args.metricsCollector,
      sourceId: this.id,
      manifestUrl,
      profile,
      name: profile ? `Shard manifest (${profile})` : "Shard manifest",
      urlParams: args.params,
    });
  }
}

export default CoSceneDataPlatformDataSourceFactory;
