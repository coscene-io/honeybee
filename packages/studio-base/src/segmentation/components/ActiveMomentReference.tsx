// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";

import type { SegmentationRuntime, SegmentationSessionState } from "../runtime";
import { useSegmentationHost, useSegmentationSession } from "../segmentationHostContext";
import type { SegmentationStore } from "../types";
import {
  MomentReferencePicker,
  parseSpatialReference,
  resolveSpatialReference,
} from "./MomentReferencePicker";

export const selectMomentReferenceRuntime = (
  state: SegmentationSessionState,
): SegmentationRuntime | undefined =>
  state.open ? (state.runtime ?? state.previewRuntime) : (state.previewRuntime ?? state.runtime);

/** Added beside the real Moment attribute value; its string is persisted by the existing form. */
export function ActiveMomentReference({
  value,
  onChange,
  recordName,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Record belonging to the actual Moment form, independent of the global annotation session. */
  recordName?: string;
}): React.JSX.Element | undefined {
  const runtime = useSegmentationSession(selectMomentReferenceRuntime);
  return runtime ? (
    <ScopedMomentReference
      store={runtime.store}
      value={value}
      onChange={onChange}
      recordName={recordName}
    />
  ) : undefined;
}

function ScopedMomentReference({
  store,
  value,
  onChange,
  recordName,
}: {
  store: StoreApi<SegmentationStore>;
  value: string;
  onChange: (value: string) => void;
  recordName?: string;
}): React.JSX.Element {
  const host = useSegmentationHost();
  const activeRecordId = useStore(store, (state) => state.document?.record.id);
  const sameRecord = recordName != undefined && activeRecordId === recordName;
  return (
    <MomentReferencePicker
      store={store}
      value={value}
      disabled={!sameRecord}
      onChange={(next) => {
        const session = host.session.getState();
        const reference = parseSpatialReference(next);
        const { document, persistedTargets } = store.getState();
        if (
          recordName != undefined &&
          selectMomentReferenceRuntime(session)?.store === store &&
          document?.record.id === recordName &&
          reference?.recordId === recordName &&
          (reference.targetType === "class"
            ? persistedTargets?.classes
            : persistedTargets?.instances
          )?.some((item) => item.id === reference.targetId) === true
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
  highlight,
}: {
  store: StoreApi<SegmentationStore>;
  value: string;
  highlight?: string;
}): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  const document = useStore(store, (state) => state.document);
  return (
    <span title={value}>
      <HighlightedText
        text={resolveSpatialReference(value, document, t) ?? value}
        highlight={highlight}
      />
    </span>
  );
}

/** A moment value holding a `spatial://` reference, shown by name and kept searchable. */
export function SpatialReferenceValue({
  value,
  highlight,
}: {
  value: string;
  /** The moment list filter, highlighted like any other value. */
  highlight?: string;
}): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  const runtime = useSegmentationSession(selectMomentReferenceRuntime);
  return runtime ? (
    <ResolvedValue store={runtime.store} value={value} highlight={highlight} />
  ) : (
    <span title={value}>
      <HighlightedText
        text={resolveSpatialReference(value, undefined, t) ?? value}
        highlight={highlight}
      />
    </span>
  );
}
