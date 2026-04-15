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

import { create } from "zustand";

import { MessagePathStructureItem } from "@foxglove/message-path";

type StructuredItemsState = {
  structureItemsByPath: Map<string, MessagePathStructureItem>;
  setStructureItemsByPath: (items: Map<string, MessagePathStructureItem>) => void;
};

export const useStructureItemsByPathStore = create<StructuredItemsState>((set) => ({
  structureItemsByPath: new Map(),
  setStructureItemsByPath: (items) => {
    set({ structureItemsByPath: items });
  },
}));
