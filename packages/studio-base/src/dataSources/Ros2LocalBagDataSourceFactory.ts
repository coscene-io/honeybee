// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  IterablePlayer,
  WorkerSerializedIterableSource,
} from "@foxglove/studio-base/players/IterablePlayer";
import { Player } from "@foxglove/studio-base/players/types";

class Ros2LocalBagDataSourceFactory implements IDataSourceFactory {
  public id = "ros2-local-bagfile";
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "ROS 2 Bag";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes = [".db3"];
  public supportsMultiFile = true;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const files = args.file ? [args.file] : args.files;
    const name = args.file ? args.file.name : args.files?.map((file) => file.name).join(", ");

    if (!files) {
      return;
    }

    const source = new WorkerSerializedIterableSource({
      initWorker: () => {
        return new Worker(
          // foxglove-depcheck-used: babel-plugin-transform-import-meta
          new URL(
            "@foxglove/studio-base/players/IterablePlayer/rosdb3/RosDb3IterableSourceWorker.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: { files },
    });

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      name,
      sourceId: this.id,
      readAheadDuration: { sec: 120, nsec: 0 },
    });
  }
}

export default Ros2LocalBagDataSourceFactory;
