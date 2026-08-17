// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { transferTypedArrays } from "@foxglove/den/worker";

import { CustomDatasetsBuilderImpl, UpdateDataAction } from "./CustomDatasetsBuilderImpl";
import { Viewport } from "./IDatasetsBuilder";

const builder = new CustomDatasetsBuilderImpl();

Comlink.expose({
  updateData: (actions: UpdateDataAction[]) => {
    builder.updateData(actions);
  },
  getViewportDatasets: (viewport: Viewport) =>
    transferTypedArrays(builder.getViewportDatasets(viewport)),
  getCsvData: () => builder.getCsvData(),
  getXRange: () => builder.getXRange(),
});
