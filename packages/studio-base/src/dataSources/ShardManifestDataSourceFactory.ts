// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

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
// honeybee-server-pro) using a presigned manifest URL. The manifest enumerates
// per-modality shards and their presigned shard URLs. Honeybee opens an
// indexed reader per active shard and merges by `logTime` in the worker.
//
// URL pattern:
//   ?ds=shard-manifest&url=<presigned-manifest-url>
//   ?ds=shard-manifest&url=...&profile=480p10
class ShardManifestDataSourceFactory implements IDataSourceFactory {
  public id = "shard-manifest";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Shard manifest (PoC)";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = true; // PoC: hidden from the open-dialog UI
  public description = "Direct-from-OSS playback via presigned manifest (PoC).";

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
