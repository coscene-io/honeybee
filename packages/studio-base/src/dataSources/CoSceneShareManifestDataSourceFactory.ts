// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  DataSourceFactoryInitializeArgs,
  IDataSourceFactory,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  IterablePlayer,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";
import {
  SHARE_MANIFEST_DIRECT_LAYOUT_URL_PARAM,
  SHARE_MANIFEST_DIRECT_MANIFEST_URL_PARAM,
  SHARE_MANIFEST_DATA_SOURCE_ID,
  SHARE_MANIFEST_HASH_PARAM,
  parseShareManifestParams,
} from "@foxglove/studio-base/util/shareManifest";

import { createShardManifestPlayer } from "./createShardManifestPlayer";

class CoSceneShareManifestDataSourceFactory implements IDataSourceFactory {
  public id = SHARE_MANIFEST_DATA_SOURCE_ID;
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Shared manifest";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = true;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const result = parseShareManifestParams(args.params);
    if (result.status === "missing") {
      throw new Error("Missing share manifest argument");
    }
    if (result.status === "expired") {
      throw new Error("Share manifest has expired");
    }
    if (result.status === "invalid") {
      throw result.error;
    }

    if (result.kind === "direct") {
      return createShardManifestPlayer({
        metricsCollector: args.metricsCollector,
        sourceId: this.id,
        manifestUrl: result.manifestUrl,
        profile: result.profile,
        name: result.profile
          ? `Shared shard manifest (${result.profile})`
          : "Shared shard manifest",
        urlParams: {
          [SHARE_MANIFEST_DIRECT_MANIFEST_URL_PARAM]: result.manifestUrl,
          ...(result.layoutUrl != undefined
            ? { [SHARE_MANIFEST_DIRECT_LAYOUT_URL_PARAM]: result.layoutUrl }
            : {}),
          ...(result.profile != undefined ? { profile: result.profile } : {}),
        },
        enablePlaybackSpillCache: args.enablePlaybackSpillCache === true,
      });
    }

    const miniMcapUrl = result.manifest.links.mini_mcap;
    const source = new WorkerSerializedIterableSource({
      initWorker: () => {
        return new Worker(
          // foxglove-depcheck-used: babel-plugin-transform-import-meta
          new URL(
            "@foxglove/studio-base/players/IterablePlayer/Mcap/McapIterableSourceWorker.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: { url: miniMcapUrl },
    });

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      sourceId: this.id,
      name: "Shared MCAP",
      urlParams: { [SHARE_MANIFEST_HASH_PARAM]: result.encodedManifest },
      readAheadDuration: { sec: 10, nsec: 0 },
      enablePlaybackSpillCache: args.enablePlaybackSpillCache === true,
    });
  }
}

export default CoSceneShareManifestDataSourceFactory;
