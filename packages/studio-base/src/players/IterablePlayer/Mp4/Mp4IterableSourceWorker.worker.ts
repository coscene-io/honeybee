// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { IterableSourceInitializeArgs } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";
import { WorkerIterableSourceWorker } from "@foxglove/studio-base/players/IterablePlayer/WorkerIterableSourceWorker";

import { DEFAULT_MP4_VIDEO_TOPIC, Mp4IterableSource } from "./Mp4IterableSource";

export function initialize(args: IterableSourceInitializeArgs): WorkerIterableSourceWorker {
  if (!args.url) {
    throw new Error("url required");
  }
  const requestedTopic = args.params?.topic;
  const source = new Mp4IterableSource({
    url: args.url,
    topic:
      requestedTopic == undefined || requestedTopic.length === 0
        ? DEFAULT_MP4_VIDEO_TOPIC
        : requestedTopic,
  });
  return Comlink.proxy(new WorkerIterableSourceWorker(source));
}

Comlink.expose(initialize);
