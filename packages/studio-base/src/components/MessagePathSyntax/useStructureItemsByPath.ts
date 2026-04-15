// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { useMemo } from "react";

import { MessagePathStructureItem } from "@foxglove/message-path";
import * as PanelAPI from "@foxglove/studio-base/PanelAPI";

import { messagePathStructures } from "./messagePathsForDatatype";
import { structureAllItemsByPath } from "./structureAllItemsByPath";
import { useStructureItemsByPathStore } from "./useStructureItemsByPathStore";

type UseStructuredItemsByPathProps = {
  noMultiSlices?: boolean;
  validTypes?: readonly string[];
};

export function useStructuredItemsByPath({
  noMultiSlices,
  validTypes,
}: UseStructuredItemsByPathProps): Map<string, MessagePathStructureItem> {
  const structureItemsByPath = useStructureItemsByPathStore((state) => state.structureItemsByPath);
  const { datatypes, topics } = PanelAPI.useDataSourceInfo();

  const messagePathStructuresForDatatype = useMemo(
    () => messagePathStructures(datatypes),
    [datatypes],
  );

  const computedStructureItemsByPath = useMemo(
    () =>
      structureAllItemsByPath({
        noMultiSlices,
        validTypes,
        messagePathStructuresForDatatype,
        topics,
      }),
    [messagePathStructuresForDatatype, noMultiSlices, topics, validTypes],
  );

  if (validTypes == undefined && noMultiSlices == undefined) {
    return structureItemsByPath.size > 0 ? structureItemsByPath : computedStructureItemsByPath;
  }
  return computedStructureItemsByPath;
}
