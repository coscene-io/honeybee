// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useState } from "react";

import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import {
  type TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

const selectSetHoveredEvent = (store: TimelineInteractionStateStore) => store.setHoveredEvent;

/** Virtualized rows may unmount without mouseleave. Each mounted row owns only its hover. */
export function useMomentHover(): {
  onHoverStart: (event: TimelinePositionedEvent) => void;
  onHoverEnd: () => void;
} {
  const setHoveredEvent = useTimelineInteractionState(selectSetHoveredEvent);
  const [source] = useState(() => Symbol("moment hover"));
  const onHoverStart = useCallback(
    (event: TimelinePositionedEvent) => {
      setHoveredEvent(event, source);
    },
    [setHoveredEvent, source],
  );
  const onHoverEnd = useCallback(() => {
    setHoveredEvent(undefined, source);
  }, [setHoveredEvent, source]);
  useEffect(() => onHoverEnd, [onHoverEnd]);
  return { onHoverStart, onHoverEnd };
}
