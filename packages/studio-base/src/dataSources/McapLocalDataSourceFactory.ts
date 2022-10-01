// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { IterablePlayer, WorkerIterablePlayer } from "@foxglove/studio-base/players/IterablePlayer";
import { McapIterableSource } from "@foxglove/studio-base/players/IterablePlayer/Mcap/McapIterableSource";
import { Player } from "@foxglove/studio-base/players/types";

class McapLocalDataSourceFactory implements IDataSourceFactory {
  public id = "mcap-local-file";
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "MCAP";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes = [".mcap"];

  // fixme - feature flag
  private _enableExperimentalWorker = true;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    if (this._enableExperimentalWorker) {
      return new WorkerIterablePlayer({
        sourceType: "mcap",
        sourceId: this.id,
        factoryArgs: args,
      });
    }

    const file = args.file;
    if (!file) {
      return;
    }

    const source = new McapIterableSource({ type: "file", file });
    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      name: file.name,
      sourceId: this.id,
    });
  }
}

export default McapLocalDataSourceFactory;
