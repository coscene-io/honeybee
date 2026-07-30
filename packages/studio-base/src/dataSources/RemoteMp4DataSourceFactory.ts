// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";

import {
  DataSourceFactoryInitializeArgs,
  IDataSourceFactory,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { IterablePlayer, WorkerIterableSource } from "@foxglove/studio-base/players/IterablePlayer";
import { DEFAULT_MP4_VIDEO_TOPIC } from "@foxglove/studio-base/players/IterablePlayer/Mp4/Mp4IterableSource";
import { Player } from "@foxglove/studio-base/players/types";

class RemoteMp4DataSourceFactory implements IDataSourceFactory {
  public id = "remote-mp4";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Remote MP4";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public supportedFileTypes = [".mp4"];
  public description = "Open an H.264/H.265 MP4 over HTTP Range requests.";

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "Remote MP4 URL",
        placeholder: "https://example.com/video.mp4",
        validate: (value: string): Error | undefined => this.#validateUrl(value),
      },
      {
        id: "topic",
        label: "Video topic",
        defaultValue: DEFAULT_MP4_VIDEO_TOPIC,
        placeholder: DEFAULT_MP4_VIDEO_TOPIC,
        validate: (value: string): Error | undefined => {
          return value.startsWith("/") ? undefined : new Error("Topic must start with /");
        },
      },
    ],
  };

  public warning =
    "The server must support byte ranges and CORS must expose the Accept-Ranges header.";

  public initialize(args: DataSourceFactoryInitializeArgs): Player {
    const url = args.params?.url;
    if (!url) {
      throw new Error("Missing url argument");
    }
    const urlError = this.#validateUrl(url);
    if (urlError) {
      throw urlError;
    }

    const requestedTopic = args.params?.topic;
    const topic =
      requestedTopic == undefined || requestedTopic.length === 0
        ? DEFAULT_MP4_VIDEO_TOPIC
        : requestedTopic;
    if (!topic.startsWith("/")) {
      throw new Error("Topic must start with /");
    }
    const source = new WorkerIterableSource({
      initWorker: () =>
        new Worker(
          // foxglove-depcheck-used: babel-plugin-transform-import-meta
          new URL(
            "@foxglove/studio-base/players/IterablePlayer/Mp4/Mp4IterableSourceWorker.worker",
            import.meta.url,
          ),
        ),
      initArgs: { url, params: { topic } },
    });

    return new IterablePlayer({
      source,
      name: url,
      metricsCollector: args.metricsCollector,
      urlParams: { url, topic },
      sourceId: this.id,
      readAheadDuration: { sec: 10, nsec: 0 },
      enablePlaybackSpillCache: args.enablePlaybackSpillCache === true,
    });
  }

  #validateUrl(value: string): Error | undefined {
    try {
      const url = new URL(value);
      const extension = path.extname(url.pathname).toLowerCase();
      return extension === ".mp4" ? undefined : new Error("URL must end with .mp4");
    } catch {
      return new Error("Enter a valid URL");
    }
  }
}

export default RemoteMp4DataSourceFactory;
