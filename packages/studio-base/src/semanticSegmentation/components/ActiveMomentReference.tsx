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
import {
  MomentReferencePicker,
  parseSpatialReference,
  resolveSpatialReference,
} from "./MomentReferencePicker";

/** Added beside the real Moment attribute value; its string is persisted by the existing form. */
export function ActiveMomentReference({
  value,
  onChange,
  recordId,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Record belonging to the actual Moment form, independent of the global annotation session. */
  recordId?: string;
}): React.JSX.Element | undefined {
  const runtime = useStore(segmentationSession, (state) => state.runtime);
  const sourceReady = useStore(
    segmentationSession,
    (state) => !("sourceReady" in state) || state.sourceReady,
  );
  return runtime ? (
    <ScopedMomentReference
      store={runtime.store}
      value={value}
      onChange={onChange}
      recordId={recordId}
      sourceReady={sourceReady}
    />
  ) : undefined;
}

function ScopedMomentReference({
  store,
  value,
  onChange,
  recordId,
  sourceReady,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  value: string;
  onChange: (value: string) => void;
  recordId?: string;
  sourceReady: boolean;
}): React.JSX.Element {
  const activeRecordId = useStore(store, (state) => state.document?.record.id);
  const sameRecord = recordId != undefined && activeRecordId === recordId;
  return (
    <MomentReferencePicker
      store={store}
      value={value}
      disabled={!sourceReady || !sameRecord}
      onChange={(next) => {
        const session = segmentationSession.getState();
        if (
          recordId != undefined &&
          session.runtime?.store === store &&
          (!("sourceReady" in session) || session.sourceReady) &&
          store.getState().document?.record.id === recordId &&
          parseSpatialReference(next)?.recordId === recordId
        ) {
          onChange(next);
        }
      }}
    />
  );
}

function ResolvedValue({
  store,
  value,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  value: string;
}): React.JSX.Element {
  const document = useStore(store, (state) => state.document);
  return <span title={value}>{resolveSpatialReference(value, document) ?? value}</span>;
}

export function SpatialReferenceValue({ value }: { value: string }): React.JSX.Element {
  const runtime = useStore(segmentationSession, (state) => state.runtime);
  return runtime ? (
    <ResolvedValue store={runtime.store} value={value} />
  ) : (
    <span>{resolveSpatialReference(value, undefined) ?? value}</span>
  );
}
