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

// Loads playback shards directly from object storage (bypassing
// honeybee-server-pro) using a manifest URL. The manifest enumerates
// per-modality shards by relative path. Honeybee opens an indexed reader
// per active shard and merges by `logTime` in the worker.
//
// URL pattern:
//   ?ds=shard-manifest&ds.url=<manifest-url>
//   ?ds=shard-manifest&ds.url=...&ds.profile=480p10
class ShardManifestDataSourceFactory implements IDataSourceFactory {
  public id = "shard-manifest";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Shard manifest";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  // Hidden from the open-dialog UI; entered exclusively via URL.
  public hidden = true;
  public description = "Direct-from-Object-Storage playback via manifest.";

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "Manifest URL",
        placeholder: "https://...presigned...manifest.json",
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const url = args.params?.url;
    if (!url) {
      throw new Error("Missing url argument: ?ds=shard-manifest&url=<presigned-manifest-url>");
    }

    const profile = args.params?.profile;

    const params: Record<string, string> = { url };
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
      urlParams: params,
      readAheadDuration: { sec: 10, nsec: 0 },
      name: profile ? `Shard manifest (${profile})` : "Shard manifest",
    });
  }
}

export default ShardManifestDataSourceFactory;
