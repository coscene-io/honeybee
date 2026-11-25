// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  useWorkspaceSlot,
  type LeftSidebarSlotItem,
  type PlaybackStepOverride,
  type ShortcutColumn,
} from "@foxglove/studio-base/context/WorkspaceSlots";
import { getBrowserSession } from "@foxglove/studio-base/util/browserSession";

import { takeProfileSwitchNotice } from "../annotationProfile";
import { segmentationPlaybackStep, useSegmentationStepLabel } from "../cameraFrames";
import { useSemanticSegmentationEnabled } from "../featureFlag";
import { useSegmentationHost, useSegmentationSession } from "../segmentationHostContext";
import { getSegmentationShortcuts } from "../shortcuts";
import { GlobalPropagationLock } from "./GlobalPropagationLock";
import { SegmentationAppBarControls } from "./SegmentationAppBarControls";
import { SpatialSidebar } from "./SpatialSidebar";

const SLOT_ID = "semanticSegmentation";

/**
 * The slot registrations of the segmentation editor (app bar entry, 空间 tab, camera step
 * override, shortcut column) and the propagation lock. Loaded on demand by
 * `SegmentationWorkspaceExtension` once the rollout flag is on.
 */
export function SegmentationWorkspaceSlots(): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  const host = useSegmentationHost();
  const annotating = useSegmentationSession((state) => state.open);
  // Annotations are read and saved only through the AnnotationService: a cloud record is needed.
  const annotatable = useSemanticSegmentationEnabled();

  const sidebarItem = useMemo<LeftSidebarSlotItem | undefined>(
    () =>
      annotatable
        ? { key: "space", item: { title: t("spaceSidebar"), component: SpatialSidebar } }
        : undefined,
    [annotatable, t],
  );
  useWorkspaceSlot("leftSidebarItems", SLOT_ID, sidebarItem);
  useWorkspaceSlot("appBarItems", SLOT_ID, SegmentationAppBarControls);

  const stepCamera = useSegmentationStepLabel();
  const playbackStep = useMemo<PlaybackStepOverride | undefined>(
    () =>
      stepCamera == undefined
        ? undefined
        : {
            backwardLabel: t("seekBackwardCamera", { camera: stepCamera }),
            forwardLabel: t("seekForwardCamera", { camera: stepCamera }),
            step: (direction, modifiers, seek, clockNs) =>
              segmentationPlaybackStep(host, direction, modifiers, seek, clockNs),
          },
    [host, stepCamera, t],
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

  // Annotation is fixed to one transcode quality and switches the page to it: say so once the page
  // is back.
  const { enqueueSnackbar } = useSnackbar();
  useEffect(() => {
    const notice = takeProfileSwitchNotice();
    if (notice) {
      enqueueSnackbar(
        t(notice.exact ? "annotationProfileSwitched" : "annotationProfileNearest", {
          height: notice.height,
        }),
        {
          variant: "info",
        },
      );
    }
  }, [enqueueSnackbar, t]);

  // Staged and unsent edits live only in memory: ask before the page goes away with them.
  useEffect(() => {
    // Electron has no browser recovery flow; preventing unload there can block window close.
    if (getBrowserSession() == undefined) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (host.registry.hasUnsavedWork()) {
        event.preventDefault();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required by older supported browsers.
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [host]);

  return <GlobalPropagationLock />;
}
