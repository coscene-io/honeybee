// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { GrowthBookContext, type GrowthBook, type JSONValue } from "@growthbook/growthbook-react";
import { useContext } from "react";

import { useCoreData, type CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import { readGrowthBookRuntimeConfig } from "@foxglove/studio-base/providers/GrowthBookProvider";
import { isAnnotationRecordName } from "@foxglove/studio-base/util/coscene/annotation";

/**
 * Rollout flag for spatial annotation (semantic segmentation). Default off: with it off no Image
 * panel mounts the editor, builds the mask layer or calls the AnnotationService, and the app bar
 * entry and the 空间 sidebar tab stay hidden. Turn it on per environment only where the
 * AnnotationService backend is deployed.
 */
export const SEMANTIC_SEGMENTATION_FEATURE_FLAG = "honeybee_semantic_segmentation";

const selectRecordName = (state: CoreDataStore) => state.record.value?.name;

/** The flag alone, default off. Works without a GrowthBookProvider (stories, isolated tests). */
export function useSemanticSegmentationFlag(): boolean {
  // The context type claims a client, but outside a provider (stories, isolated tests) it has none.
  const growthbook = useContext(GrowthBookContext).growthbook as GrowthBook | undefined;
  const fallbackValues = readGrowthBookRuntimeConfig().fallbackValues;
  const fallback: JSONValue = Object.hasOwn(fallbackValues, SEMANTIC_SEGMENTATION_FEATURE_FLAG)
    ? fallbackValues[SEMANTIC_SEGMENTATION_FEATURE_FLAG]!
    : false;
  const value =
    growthbook == undefined
      ? fallback
      : growthbook.getFeatureValue<JSONValue>(SEMANTIC_SEGMENTATION_FEATURE_FLAG, fallback);
  return value === true;
}

/** True when the flag is on and the open source is a cloud record the AnnotationService can address. */
export function semanticSegmentationAvailable({
  flagOn,
  recordName,
}: {
  flagOn: boolean;
  recordName: string | undefined;
}): boolean {
  return flagOn && isAnnotationRecordName(recordName);
}

/** Flag on and a cloud record open: the only condition under which annotation UI mounts. */
export function useSemanticSegmentationEnabled(): boolean {
  const flagOn = useSemanticSegmentationFlag();
  const recordName = useCoreData(selectRecordName);
  return semanticSegmentationAvailable({ flagOn, recordName });
}
