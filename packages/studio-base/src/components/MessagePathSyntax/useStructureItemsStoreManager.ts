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

import { useEffect, useMemo } from "react";

import * as PanelAPI from "@foxglove/studio-base/PanelAPI";

import { messagePathStructures } from "./messagePathsForDatatype";
import { structureAllItemsByPath } from "./structureAllItemsByPath";
import { useStructureItemsByPathStore } from "./useStructureItemsByPathStore";

export function useStructureItemsStoreManager(): void {
  const setStructureItemsByPath = useStructureItemsByPathStore(
    (state) => state.setStructureItemsByPath,
  );
  const { datatypes, topics } = PanelAPI.useDataSourceInfo();

  const messagePathStructuresForDatatype = useMemo(
    () => messagePathStructures(datatypes),
    [datatypes],
  );

  useEffect(() => {
    setStructureItemsByPath(
      structureAllItemsByPath({
        messagePathStructuresForDatatype,
        topics,
      }),
    );
  }, [messagePathStructuresForDatatype, setStructureItemsByPath, topics]);
}
