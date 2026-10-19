// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import { fromNanoSec, toNanoSec, type Time } from "@foxglove/rostime";
import {
  type MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";

import { useAppTimeFormat, type IAppTimeFormat } from "./useAppTimeFormat";

const selectOrigin = (ctx: MessagePipelineContext) => {
  const start = ctx.playerState.activeData?.startTime;
  return start == undefined ? undefined : toNanoSec(start);
};

/** All playback surfaces share the data-source start, independently of the playhead/viewport. */
export function usePlaybackTimeFormat(): IAppTimeFormat & { playbackOrigin?: Time } {
  const originNanos = useMessagePipeline(selectOrigin);
  const origin = useMemo(
    () => (originNanos == undefined ? undefined : fromNanoSec(originNanos)),
    [originNanos],
  );
  const format = useAppTimeFormat(origin);
  return { ...format, playbackOrigin: origin };
}
