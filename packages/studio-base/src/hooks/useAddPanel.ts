// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useCallback } from "react";

import { PanelSelection } from "@foxglove/studio-base/components/PanelCatalog";
import { useCurrentLayoutActions } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { getPanelIdForType } from "@foxglove/studio-base/util/layout";

export default function useAddPanel(): (selection: PanelSelection) => void {
  const { addPanel } = useCurrentLayoutActions();
  return useCallback(
    ({ type, config }: PanelSelection) => {
      const id = getPanelIdForType(type);
      addPanel({ id, config });
    },
    [addPanel],
  );
}
