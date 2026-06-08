// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import * as _ from "lodash-es";

import { RosNode } from "@foxglove/ros1";
import OsContextSingleton from "@foxglove/studio-base/OsContextSingleton";
import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import Ros1Player from "@foxglove/studio-base/players/Ros1Player";
import { Player } from "@foxglove/studio-base/players/types";

class Ros1SocketDataSourceFactory implements IDataSourceFactory {
  public id = "ros1-socket";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "ROS 1";
  public iconName: IDataSourceFactory["iconName"] = "ROS";
  public description = t("openDialog:ros1SocketDataSourceDesc");
  public docsLinks = [{ url: "https://foxglove.dev/docs/studio/connection/native" }];

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "ROS_MASTER_URI",
        defaultValue: OsContextSingleton?.getEnvVar("ROS_MASTER_URI") ?? "http://localhost:11311",
        description: t("openDialog:rosMasterUriDesc"),
      },
      {
        id: "hostname",
        label: "ROS_HOSTNAME",
        defaultValue: OsContextSingleton
          ? RosNode.GetRosHostname(
              OsContextSingleton.getEnvVar,
              OsContextSingleton.getHostname,
              OsContextSingleton.getNetworkInterfaces,
            )
          : "localhost",
        description: t("openDialog:rosHostnameDesc"),
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const url = args.params?.url;
    if (!url) {
      return;
    }

    const hostname = args.params?.hostname;
    if (!_.isUndefined(hostname) && !_.isString(hostname)) {
      throw new Error(`Unable to initialize Ros1. Invalid hostname ${hostname}`);
    }

    return new Ros1Player({
      url,
      hostname,
      metricsCollector: args.metricsCollector,
      sourceId: this.id,
    });
  }
}

export default Ros1SocketDataSourceFactory;
