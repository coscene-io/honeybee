// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { IterableSourceInitializeArgs } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { WorkerSerializedIterableSourceWorker } from "@foxglove/studio-base/players/IterablePlayer/WorkerSerializedIterableSourceWorker";

import { BagIterableSource } from "./BagIterableSource";

export function initialize(
  args: IterableSourceInitializeArgs,
): WorkerSerializedIterableSourceWorker {
  if (args.file) {
    const source = new BagIterableSource({ type: "file", file: args.file });
    const wrapped = new WorkerSerializedIterableSourceWorker(source);
    return Comlink.proxy(wrapped);
  } else if (args.url) {
    const source = new BagIterableSource({ type: "remote", url: args.url });
    const wrapped = new WorkerSerializedIterableSourceWorker(source);
    return Comlink.proxy(wrapped);
  }

  throw new Error("file or url required");
}

Comlink.expose(initialize);
