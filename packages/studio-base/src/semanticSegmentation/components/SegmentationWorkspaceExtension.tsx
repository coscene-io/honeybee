// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import {
  useWorkspaceSlot,
  type LeftSidebarSlotItem,
  type MomentValueRenderer,
  type PlaybackStepOverride,
  type ShortcutColumn,
} from "@foxglove/studio-base/context/WorkspaceSlots";

import { annotationRecord } from "../annotationRecord";
import { segmentationPlaybackStep, useSegmentationStepLabel } from "../cameraFrames";
import { semanticSegmentationAvailable, useSemanticSegmentationFlag } from "../featureFlag";
import { segmentationSession } from "../runtime";
import { getSegmentationShortcuts } from "../shortcuts";
import { ActiveMomentReference, SpatialReferenceValue } from "./ActiveMomentReference";
import { GlobalPropagationLock } from "./GlobalPropagationLock";
import { SegmentationAppBarControls } from "./SegmentationAppBarControls";
import { SpatialSidebar } from "./SpatialSidebar";

const SLOT_ID = "semanticSegmentation";

const renderMomentValue: MomentValueRenderer = ({ value, highlight }) =>
  value.startsWith("spatial://") ? (
    <SpatialReferenceValue value={value} highlight={highlight} />
  ) : undefined;

/**
 * Plugs the segmentation editor into the shared workspace chrome through WorkspaceSlots, so
 * shared components never import this feature. Mount it once, in the Workspace.
 *
 * With the `honeybee_semantic_segmentation` rollout flag off nothing is registered or mounted:
 * no app bar entry, no 空间 tab, no camera step override, no propagation lock.
 */
export function SegmentationWorkspaceExtension(): React.JSX.Element | ReactNull {
  const flagOn = useSemanticSegmentationFlag();
  return flagOn ? <SegmentationWorkspaceSlots /> : ReactNull;
}

function SegmentationWorkspaceSlots(): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  const recordName = useStore(annotationRecord, (state) => state.recordName);
  const annotating = useStore(segmentationSession, (state) => state.open);
  // Annotations are read and saved only through the AnnotationService. The flag is on here.
  const annotatable = semanticSegmentationAvailable({ flagOn: true, recordName });

  const sidebarItem = useMemo<LeftSidebarSlotItem | undefined>(
    () =>
      annotatable
        ? { key: "space", item: { title: t("spaceSidebar"), component: SpatialSidebar } }
        : undefined,
    [annotatable, t],
  );
  useWorkspaceSlot("leftSidebarItems", SLOT_ID, sidebarItem);
  useWorkspaceSlot("appBarItems", SLOT_ID, SegmentationAppBarControls);
  useWorkspaceSlot("momentValueRenderers", SLOT_ID, renderMomentValue);
  useWorkspaceSlot("momentValueAdornments", SLOT_ID, ActiveMomentReference);

  const stepCamera = useSegmentationStepLabel();
  const playbackStep = useMemo<PlaybackStepOverride | undefined>(
    () =>
      stepCamera == undefined
        ? undefined
        : {
            backwardLabel: t("seekBackwardCamera", { camera: stepCamera }),
            forwardLabel: t("seekForwardCamera", { camera: stepCamera }),
            step: segmentationPlaybackStep,
          },
    [stepCamera, t],
  );
  useWorkspaceSlot("playbackStep", SLOT_ID, playbackStep);

  const shortcutColumn = useMemo<ShortcutColumn | undefined>(() => {
    if (!annotating) {
      return undefined;
    }
    const { sections } = getSegmentationShortcuts(navigator.userAgent, {
      drag: t("shortcutDrag"),
      click: t("shortcutClick"),
    });
    return {
      title: t("shortcutColumnTitle"),
      sections: sections.map((section) => ({
        title: t(section.titleKey),
        rows: section.rows.map((row) => ({ label: t(row.labelKey), keys: row.keys })),
      })),
    };
  }, [annotating, t]);
  useWorkspaceSlot("shortcutColumns", SLOT_ID, shortcutColumn);

  return <GlobalPropagationLock />;
}
