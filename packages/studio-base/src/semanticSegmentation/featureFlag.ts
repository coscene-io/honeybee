// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCoreData, type CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import { useOptionalFeatureIsOnWithConfig } from "@foxglove/studio-base/providers/GrowthBookProvider";
import { isAnnotationRecordName } from "@foxglove/studio-base/util/coscene/annotationRecordName";

/**
 * Rollout flag for spatial annotation (semantic segmentation). Default off: with it off no Image
 * panel mounts the editor, builds the mask layer or calls the AnnotationService, and the app bar
 * entry and the 空间 sidebar tab stay hidden. Turn it on per environment only where the
 * AnnotationService backend is deployed.
 */
export const SEMANTIC_SEGMENTATION_FEATURE_FLAG = "honeybee_semantic_segmentation";

const selectRecordName = (state: CoreDataStore) => state.record.value?.name;
const selectDataSource = (state: CoreDataStore) => state.dataSource;

/** The data source whose records live in the cloud and can carry annotations. */
const CLOUD_DATA_SOURCE_ID = "coscene-data-platform";

/** The flag alone, default off. Works without a GrowthBookProvider (isolated tests). */
export function useSemanticSegmentationFlag(): boolean {
  return useOptionalFeatureIsOnWithConfig(SEMANTIC_SEGMENTATION_FEATURE_FLAG);
}

/**
 * True when the flag is on and the open source is a cloud record the AnnotationService can
 * address. The record in Core Data is not cleared when a local file is opened afterwards, so the
 * data source must be the cloud one too.
 */
export function semanticSegmentationAvailable({
  flagOn,
  recordName,
  dataSourceId,
}: {
  flagOn: boolean;
  recordName: string | undefined;
  dataSourceId: string | undefined;
}): boolean {
  return flagOn && dataSourceId === CLOUD_DATA_SOURCE_ID && isAnnotationRecordName(recordName);
}

/** Flag on and a cloud record open: the only condition under which annotation UI mounts. */
export function useSemanticSegmentationEnabled(): boolean {
  const flagOn = useSemanticSegmentationFlag();
  const recordName = useCoreData(selectRecordName);
  const dataSource = useCoreData(selectDataSource);
  const dataSourceId = dataSource?.type === "connection" ? dataSource.id : undefined;
  return semanticSegmentationAvailable({ flagOn, recordName, dataSourceId });
}
