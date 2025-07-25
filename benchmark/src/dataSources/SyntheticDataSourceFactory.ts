// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { Player } from "@foxglove/studio-base/players/types";

type PlayerConstructor = new () => Player;

class SyntheticDataSourceFactory implements IDataSourceFactory {
  public id;
  public type: IDataSourceFactory["type"] = "sample";
  public displayName = "Synthetic";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public sampleLayout: IDataSourceFactory["sampleLayout"];

  #newFn: PlayerConstructor;

  public constructor(
    id: string,
    newFn: PlayerConstructor,
    layout: IDataSourceFactory["sampleLayout"],
  ) {
    this.id = id;
    this.#newFn = newFn;
    this.sampleLayout = layout;
  }

  public initialize(_args: DataSourceFactoryInitializeArgs): Player | undefined {
    return new this.#newFn();
  }
}

export { SyntheticDataSourceFactory };
