// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { transferTypedArrays } from "@foxglove/den/worker";
import { TimestampDatasetsBuilderImpl } from "@foxglove/studio-base/panels/Plot/builders/TimestampDatasetsBuilderImpl";
import {
  PackedStateTransitionDataset,
  StateTransitionsDatasetAction,
  StateTransitionsDatasetBuilderImpl,
  StateTransitionsDatasetRequest,
} from "@foxglove/studio-base/panels/StateTransitions/StateTransitionsDatasetBuilderImpl";

export type StateTransitionsDatasetSessionService = {
  applyActions(actions: StateTransitionsDatasetAction[]): void;
  getViewportDatasets(request: StateTransitionsDatasetRequest): PackedStateTransitionDataset[];
};

export type Service<TTimestampDatasetsBuilder, TStateTransitionsDatasetBuilder> = {
  createTimestampDatasetsBuilder(): Promise<TTimestampDatasetsBuilder>;
  createStateTransitionsDatasetBuilder(): Promise<TStateTransitionsDatasetBuilder>;
};

Comlink.expose({
  async createTimestampDatasetsBuilder() {
    return Comlink.proxy(new TimestampDatasetsBuilderImpl());
  },
  async createStateTransitionsDatasetBuilder() {
    const builder = new StateTransitionsDatasetBuilderImpl();
    return Comlink.proxy({
      applyActions(actions) {
        builder.applyActions(actions);
      },
      getViewportDatasets(request) {
        return transferTypedArrays(builder.getViewportDatasets(request));
      },
    } satisfies StateTransitionsDatasetSessionService);
  },
} satisfies Service<
  Comlink.LocalObject<TimestampDatasetsBuilderImpl>,
  Comlink.LocalObject<StateTransitionsDatasetSessionService>
>);
