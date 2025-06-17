// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import FoxgloveWebSocketPlayer from "@foxglove/studio-base/players/FoxgloveWebSocketPlayer";
import { Player } from "@foxglove/studio-base/players/types";
import { windowAppURLState } from "@foxglove/studio-base/util/appURLState";

export default class FoxgloveWebSocketDataSourceFactory implements IDataSourceFactory {
  public id = "coscene-websocket";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "coBridge";
  public iconName: IDataSourceFactory["iconName"] = "Flow";
  public description = t("openDialog:webSocketDataSourceDesc");
  public docsLinks = [
    {
      label: t("openDialog:downloadCoBridge"),
      url: "https://github.com/coscene-io/coBridge",
    },
  ];
  public showDocs = true;

  // public docsLinks = [
  //   {
  //     label: "ROS 1",
  //     url: "https://docs.foxglove.dev/docs/connecting-to-data/frameworks/ros1#foxglove-websocket",
  //   },
  //   {
  //     label: "ROS 2",
  //     url: "https://docs.foxglove.dev/docs/connecting-to-data/frameworks/ros2#foxglove-websocket",
  //   },
  //   {
  //     label: "custom data",
  //     url: "https://docs.foxglove.dev/docs/connecting-to-data/frameworks/custom#foxglove-websocket",
  //   },
  // ];

  #confirm: confirmTypes;
  #userId: string;
  #username: string;
  #deviceName: string;

  public constructor({ confirm }: { confirm: confirmTypes }) {
    const userStore = localStorage.getItem("user-storage") ?? "{}";
    const userInfo = JSON.parse(userStore);
    const currentUserId = userInfo?.state?.user?.userId ?? "";
    const currentUsername = userInfo?.state?.user?.nickName ?? "";
    const deviceName = windowAppURLState()?.dsParams?.hostName ?? "";

    this.#userId = currentUserId;
    this.#username = currentUsername;
    this.#deviceName = deviceName;

    this.#confirm = confirm;
  }

  public formConfig = {
    fields: [
      {
        id: "url",
        label: t("openDialog:webSocketUrl"),
        defaultValue: "ws://localhost:21274",
        validate: (newValue: string): Error | undefined => {
          try {
            const url = new URL(newValue);
            if (url.protocol !== "ws:" && url.protocol !== "wss:") {
              return new Error(`Invalid protocol: ${url.protocol}`);
            }
            return undefined;
          } catch {
            return new Error("Enter a valid url");
          }
        },
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const url = args.params?.url;
    if (!url) {
      return;
    }

    return new FoxgloveWebSocketPlayer({
      url,
      metricsCollector: args.metricsCollector,
      sourceId: this.id,
      params: args.params ?? {},
      confirm: this.#confirm,
      userId: this.#userId,
      username: this.#username,
      deviceName: this.#deviceName,
      authHeader: args.consoleApi?.getAuthHeader() ?? "",
    });
  }
}
