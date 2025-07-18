// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button } from "@mui/material";
import { t } from "i18next";
import path from "path";

import {
  DataSourceFactoryInitializeArgs,
  IDataSourceFactory,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  IterablePlayer,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const initWorkers: Record<string, () => Worker> = {
  ".bag": () => {
    return new Worker(
      // foxglove-depcheck-used: babel-plugin-transform-import-meta
      new URL(
        "@foxglove/studio-base/players/IterablePlayer/BagIterableSourceWorker.worker",
        import.meta.url,
      ),
    );
  },
  ".mcap": () => {
    return new Worker(
      // foxglove-depcheck-used: babel-plugin-transform-import-meta
      new URL(
        "@foxglove/studio-base/players/IterablePlayer/Mcap/McapIterableSourceWorker.worker",
        import.meta.url,
      ),
    );
  },
};

class RemoteDataSourceFactory implements IDataSourceFactory {
  public id = "remote-file";

  // The remote file feature use to be handled by two separate factories with these IDs.
  // We consolidated this into one factory that appears in the "connection" list and has a `url` field.
  //
  // To keep backwards compatability with deep-link urls that used these ids we provide them as legacy aliases
  public legacyIds = ["mcap-remote-file", "ros1-remote-bagfile"];

  public type: IDataSourceFactory["type"] = "connection";
  public displayName = t("openDialog:remoteFile");
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public supportedFileTypes = [".bag", ".mcap"];
  public description = t("openDialog:remoteDataSourceDesc");
  public docsLinks = [
    {
      label: "ROS 1",
      url: "https://docs.foxglove.dev/docs/connecting-to-data/frameworks/ros1#remote-file",
    },
    {
      label: "MCAP",
      url: "https://docs.foxglove.dev/docs/connecting-to-data/frameworks/mcap#remote-file",
    },
  ];

  public formConfig = {
    fields: [
      {
        id: "url",
        label: t("openDialog:remoteFileUrl"),
        placeholder: "https://example.com/file.bag",
        validate: (newValue: string): Error | undefined => {
          return this.#validateUrl(newValue);
        },
      },
    ],
  };

  public warning = (
    <>
      {t("openDialog:loadingLargeFilesOverHttpCanBeSlow")}
      <Button
        href={`https://${APP_CONFIG.DOMAIN_CONFIG.default?.webDomain}`}
        target="_blank"
        variant="text"
      >
        {t("openDialog:coSceneDataPlatform")}
      </Button>
      .
    </>
  );

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const url = args.params?.url;
    if (!url) {
      throw new Error("Missing url argument");
    }

    const extension = path.extname(new URL(url).pathname);
    const initWorker = initWorkers[extension];
    if (!initWorker) {
      throw new Error(t("openDialog:unsupportedExtension", { extension }));
    }

    const source = new WorkerSerializedIterableSource({ initWorker, initArgs: { url } });
    return new IterablePlayer({
      source,
      name: url,
      metricsCollector: args.metricsCollector,
      // Use blank url params so the data source is set in the url
      urlParams: { url },
      sourceId: this.id,
      readAheadDuration: { sec: 10, nsec: 0 },
    });
  }

  #validateUrl(newValue: string): Error | undefined {
    try {
      const url = new URL(newValue);
      const extension = path.extname(url.pathname);

      if (extension.length === 0) {
        return new Error(t("openDialog:urlMustEndWithAFileExtension"));
      }

      if (!this.supportedFileTypes.includes(extension)) {
        const supportedExtensions = new Intl.ListFormat("en-US", { style: "long" }).format(
          this.supportedFileTypes,
        );
        return new Error(
          t("openDialog:onlySupportedExtensions", { extensions: supportedExtensions }),
        );
      }

      return undefined;
    } catch {
      return new Error(t("openDialog:enterAValidUrl"));
    }
  }
}

export default RemoteDataSourceFactory;
