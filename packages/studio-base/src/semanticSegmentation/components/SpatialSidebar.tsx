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
}: {
  store: StoreApi<SemanticSegmentationStore>;
  sourceReady: boolean;
}): React.JSX.Element {
  const unavailable = useStore(
    store,
    (state) =>
      state.loading || state.readonly || ["running", "stopping"].includes(state.propagation.status),
  );
  return <SpatialTree store={store} disabled={!sourceReady || unavailable} />;
}

export function SpatialSidebar(): React.JSX.Element {
  const runtime = useStore(segmentationSession, (state) => state.runtime);
  const sourceReady = useStore(
    segmentationSession,
    (state) => !("sourceReady" in state) || state.sourceReady,
  );
  return runtime ? (
    <BoundTree store={runtime.store} sourceReady={sourceReady} />
  ) : (
    <div style={{ padding: 16 }}>
      在顶栏点击「编辑空间标注」进入空间工作台。同一实例可以画在这段记录的各个相机上。
    </div>
  );
}
