// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { styled } from "@mui/material/styles";
import { useContext } from "react";
import { useStore } from "zustand";

import { type Time, toNanoSec } from "@foxglove/rostime";
import {
  timeToFraction,
  type TimelineViewport,
} from "@foxglove/studio-base/components/PlaybackControls/timelineViewport";
import {
  PlaybackDiagnosticsContext,
  type PlaybackDiagnostics,
} from "@foxglove/studio-base/services/playbackDiagnostics";

const Overlay = styled("div")(({ theme }) => ({
  position: "absolute",
  zIndex: 3,
  pointerEvents: "none",
  top: 0,
  bottom: 0,
  minWidth: 2,
  backgroundColor: theme.palette.info.main,
  opacity: 0.4,
}));

type Props = { startTime: Time; viewport: TimelineViewport };

function Preview({
  session,
  viewport,
  startTime,
}: Props & { session: PlaybackDiagnostics }): React.JSX.Element | ReactNull {
  const range = useStore(session.preview, (state) => (state.hovered ?? state.focused)?.range);
  if (!range) {
    return ReactNull;
  }
  const origin = toNanoSec(startTime);
  const left = Math.max(0, timeToFraction(Number(range.start - origin) / 1e9, viewport));
  const right = Math.min(1, timeToFraction(Number(range.end - origin) / 1e9, viewport));
  if (left > right) {
    return ReactNull;
  }
  return (
    <Overlay
      aria-hidden
      data-testid="diagnostic-preview"
      style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
    />
  );
}

export function DiagnosticPreview(props: Props): React.JSX.Element | ReactNull {
  const session = useContext(PlaybackDiagnosticsContext);
  return session ? <Preview {...props} session={session} /> : ReactNull;
}
