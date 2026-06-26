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
  SHARE_MANIFEST_DATA_SOURCE_ID,
  SHARE_MANIFEST_HASH_PARAM,
  parseEncodedShareManifest,
} from "@foxglove/studio-base/util/shareManifest";

class CoSceneShareManifestDataSourceFactory implements IDataSourceFactory {
  public id = SHARE_MANIFEST_DATA_SOURCE_ID;
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Shared manifest";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = true;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const encodedManifest = args.params?.[SHARE_MANIFEST_HASH_PARAM];
    if (!encodedManifest) {
      throw new Error("Missing share manifest argument");
    }

    const result = parseEncodedShareManifest(encodedManifest);
    if (result.status === "expired") {
      throw new Error("Share manifest has expired");
    }
    if (result.status === "invalid") {
      throw result.error;
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
      urlParams: { [SHARE_MANIFEST_HASH_PARAM]: encodedManifest },
      readAheadDuration: { sec: 10, nsec: 0 },
      enablePlaybackSpillCache: true,
      playbackSpillCacheSourceKey: JSON.stringify({ sourceId: this.id, url: miniMcapUrl }),
    });
  }
}

export default CoSceneShareManifestDataSourceFactory;
