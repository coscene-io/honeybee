// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutPermission } from "@foxglove/studio-base/services/CoSceneILayoutStorage";


export type LayoutHistory = {
  id: LayoutID;
  parent: string;
  permission: LayoutPermission;
};

export interface ILayoutHistoryStorage {
  get(namespace: string, parent: string): Promise<LayoutHistory | undefined>;
  put(namespace: string, layout: LayoutHistory): Promise<LayoutHistory>;
  // delete(namespace: string, id: LayoutID): Promise<void>;
}
