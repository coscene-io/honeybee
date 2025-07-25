// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MarkOptional } from "ts-essentials";

import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";

import { migrateLegacyToNew3DPanels } from "./migrateLegacyToNew3DPanels";
import { migrateLegacyToNewImagePanels } from "./migrateLegacyToNewImagePanels";

/**
 * Perform any necessary migrations on old layout data.
 */
export function migratePanelsState(data: MarkOptional<LayoutData, "configById">): LayoutData {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  let result: LayoutData = { ...data, configById: data.configById ?? data.savedProps ?? {} };
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  delete result.savedProps;

  result = migrateLegacyToNew3DPanels(result);
  result = migrateLegacyToNewImagePanels(result);

  return result;
}
