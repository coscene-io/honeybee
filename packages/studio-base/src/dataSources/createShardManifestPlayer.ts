// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { DataSourceFactoryInitializeArgs } from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  IterablePlayer,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";
import {
  MANIFEST_URL_PARAM,
  SHARD_MODE_MANIFEST,
  SHARD_MODE_PARAM,
} from "@foxglove/studio-base/util/shardManifestUrlParams";

export function definedUrlParams(
  params?: Record<string, string | undefined>,
): Record<string, string> {
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

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value != undefined && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = sortJsonValue(input[key]);
    }
    return output;
  }
  return value;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value)) ?? "";
}

export function createShardManifestPlayer(args: {
  metricsCollector: DataSourceFactoryInitializeArgs["metricsCollector"];
  sourceId: string;
  manifestUrl: string;
  profile?: string;
  name: string;
  urlParams?: Record<string, string | undefined>;
}): Player {
  const sourceParams: Record<string, string> = { url: args.manifestUrl };
  if (args.profile != undefined) {
    sourceParams.profile = args.profile;
  }

  const source = new WorkerSerializedIterableSource({
    initWorker: () => {
      return new Worker(
        // foxglove-depcheck-used: babel-plugin-transform-import-meta
        new URL(
          "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/ShardManifestIterableSource.worker",
          import.meta.url,
        ),
      );
    },
    initArgs: { params: sourceParams },
  });

  const urlParams: Record<string, string> = {
    ...definedUrlParams(args.urlParams),
    [SHARD_MODE_PARAM]: SHARD_MODE_MANIFEST,
    [MANIFEST_URL_PARAM]: args.manifestUrl,
  };
  if (args.profile != undefined) {
    urlParams.profile = args.profile;
  } else {
    delete urlParams.profile;
  }

  return new IterablePlayer({
    metricsCollector: args.metricsCollector,
    source,
    sourceId: args.sourceId,
    urlParams,
    readAheadDuration: { sec: 10, nsec: 0 },
    name: args.name,
    enablePlaybackSpillCache: true,
    playbackSpillCacheSourceKey: stableJsonStringify({
      sourceId: args.sourceId,
      params: sourceParams,
    }),
  });
}
