// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@coscene-io/comlink";

import { IterableSourceInitializeArgs } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { WorkerSerializedIterableSourceWorker } from "@foxglove/studio-base/players/IterablePlayer/WorkerSerializedIterableSourceWorker";

import { initialize as ShardManifestIterableSourceInitialize } from "./ShardManifestIterableSource";

export function initialize(args: IterableSourceInitializeArgs): WorkerSerializedIterableSourceWorker {
  const source = ShardManifestIterableSourceInitialize(args);
  const wrapped = new WorkerSerializedIterableSourceWorker(source);
  return Comlink.proxy(wrapped);
}

Comlink.expose(initialize);
