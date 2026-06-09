// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { IterableSourceInitializeArgs } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { WorkerSerializedIterableSourceWorker } from "@foxglove/studio-base/players/IterablePlayer/WorkerSerializedIterableSourceWorker";

import { initialize as ShardManifestIterableSourceInitialize } from "./ShardManifestIterableSource";

export function initialize(
  args: IterableSourceInitializeArgs,
): WorkerSerializedIterableSourceWorker {
  const source = ShardManifestIterableSourceInitialize(args);
  const wrapped = new WorkerSerializedIterableSourceWorker(source);
  return Comlink.proxy(wrapped);
}

Comlink.expose(initialize);
