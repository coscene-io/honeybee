// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import { useWorkspaceSlotValues } from "@foxglove/studio-base/context/WorkspaceSlots";

/**
 * A moment metadata value. A feature may render values it owns (see WorkspaceSlots
 * `momentValueRenderers`); anything else is plain text with the list filter highlighted.
 */
export function MomentMetadataValue({
  value,
  highlight,
}: {
  value: string;
  highlight?: string;
}): React.JSX.Element {
  const renderers = useWorkspaceSlotValues("momentValueRenderers");
  for (const render of renderers) {
    const node = render({ value, highlight });
    if (node != undefined) {
      return <>{node}</>;
    }
  }
  return <HighlightedText text={value} highlight={highlight} />;
}
