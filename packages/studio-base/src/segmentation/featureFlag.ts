// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useContext } from "react";

import { useCoreData, type CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import { useOptionalFeatureIsOnWithConfig } from "@foxglove/studio-base/providers/GrowthBookProvider";

/**
 * Rollout flag for segmentation. Default off: with it off no Image
 * panel mounts the editor, builds the mask layer or calls the AnnotationService, and the app bar
 * entry and the "Space" sidebar tab stay hidden. Turn it on per environment only where the
 * AnnotationService backend is deployed.
 */
import { isSegmentationRecordName } from "./recordName";
import { SegmentationHostContext, useHostHasUnsavedWork } from "./segmentationHostContext";

export const SEGMENTATION_FEATURE_FLAG = "honeybee_semantic_segmentation";

/**
 * The record that is actually open. While another record is requested, Core Data keeps the
 * previous one as the value until the new one is read (CoreDataSyncAdapter); annotating then would
 * show and write the previous record's annotations over the new recording. So when a record is
 * requested, only that record counts. Reloading the same record keeps it.
 */
export function openRecordName(
  state: Pick<CoreDataStore, "record" | "externalInitConfig">,
): string | undefined {
  const name = state.record.value?.name;
  const config = state.externalInitConfig;
  if (config?.warehouseId && config.projectId && config.recordId) {
    const requested = `warehouses/${config.warehouseId}/projects/${config.projectId}/records/${config.recordId}`;
    return name === requested ? name : undefined;
  }
  return name;
}

const selectRecordName = (state: CoreDataStore) => openRecordName(state);
const selectDataSource = (state: CoreDataStore) => state.dataSource;

/** The data source whose records live in the cloud and can carry annotations. */
const CLOUD_DATA_SOURCE_ID = "coscene-data-platform";

/**
 * The flag, default off. Works without a GrowthBookProvider (isolated tests). Turning it off
 * remotely does not take effect while the workspace still holds unsaved annotation work: the
 * editor stays until that work is saved or discarded, rather than dropping it unasked.
 */
export function useSegmentationFlag(): boolean {
  const remote = useOptionalFeatureIsOnWithConfig(SEGMENTATION_FEATURE_FLAG);
  const unsaved = useHostHasUnsavedWork(useContext(SegmentationHostContext));
  return remote || unsaved;
}

/**
 * True when the flag is on and the open source is a cloud record the AnnotationService can
 * address. The record in Core Data is not cleared when a local file is opened afterwards, so the
 * data source must be the cloud one too.
 */
export function segmentationAvailable({
  flagOn,
  recordName,
  dataSourceId,
}: {
  flagOn: boolean;
  recordName: string | undefined;
  dataSourceId: string | undefined;
}): boolean {
  return flagOn && dataSourceId === CLOUD_DATA_SOURCE_ID && isSegmentationRecordName(recordName);
}

/** Flag on and a cloud record open: the only condition under which annotation UI mounts. */
export function useSegmentationEnabled(): boolean {
  const flagOn = useSegmentationFlag();
  const recordName = useCoreData(selectRecordName);
  const dataSource = useCoreData(selectDataSource);
  const dataSourceId = dataSource?.type === "connection" ? dataSource.id : undefined;
  return segmentationAvailable({ flagOn, recordName, dataSourceId });
}
