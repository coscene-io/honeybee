// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { segmentationSession } from "../runtime";
import type { SemanticSegmentationStore } from "../types";
import { SpatialTree } from "./SpatialTree";

function BoundTree({
  store,
  sourceReady,
  open,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  sourceReady: boolean;
  open: boolean;
}): React.JSX.Element {
  const unavailable = useStore(
    store,
    (state) =>
      state.loading || state.readonly || ["running", "stopping"].includes(state.propagation.status),
  );
  return <SpatialTree store={store} disabled={!open || !sourceReady || unavailable} />;
}

export function SpatialSidebar(): React.JSX.Element {
  const open = useStore(segmentationSession, (state) => state.open);
  const runtime = useStore(segmentationSession, (state) =>
    state.open ? state.runtime : (state.previewRuntime ?? state.runtime),
  );
  const sourceReady = useStore(
    segmentationSession,
    (state) => !("sourceReady" in state) || state.sourceReady,
  );
  return runtime ? (
    <>
      <div style={{ padding: 8 }}>
        {open ? "所有相机 · 类别和实例为记录共享" : "各相机当前画面 · 只读"}
      </div>
      <BoundTree store={runtime.store} sourceReady={sourceReady} open={open} />
    </>
  ) : (
    <div style={{ padding: 16 }}>
      在顶栏点击「编辑空间标注」。类别和实例在记录内共享，多边形属于各相机的具体帧。
    </div>
  );
}
