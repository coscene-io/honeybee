// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { useSegmentationSession } from "../segmentationHostContext";
import type { SegmentationStore } from "../types";
import { SegmentationTree } from "./SegmentationTree/SegmentationTree";

function BoundTree({
  store,
  sourceReady,
  open,
}: {
  store: StoreApi<SegmentationStore>;
  sourceReady: boolean;
  open: boolean;
}): React.JSX.Element {
  const unavailable = useStore(
    store,
    (state) => state.loading || ["running", "stopping"].includes(state.propagation.status),
  );
  // Waiting for the edited camera's image only holds back edits. Choosing rows and switching
  // frames stay available, so a new seek or frame switch can replace the wait.
  return (
    <SegmentationTree store={store} disabled={!open || unavailable} editLocked={!sourceReady} />
  );
}

const useStyles = makeStyles()((theme) => ({
  caption: { padding: theme.spacing(1) },
  empty: { padding: theme.spacing(2) },
}));

export function SegmentationSidebar(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const open = useSegmentationSession((state) => state.open);
  const runtime = useSegmentationSession((state) =>
    state.open ? state.runtime : (state.previewRuntime ?? state.runtime),
  );
  const sourceReady = useSegmentationSession((state) => state.sourceReady);
  return runtime ? (
    <>
      <div className={classes.caption}>{open ? t("sidebarOpen") : t("sidebarPreview")}</div>
      <BoundTree store={runtime.store} sourceReady={sourceReady} open={open} />
    </>
  ) : (
    <div className={classes.empty}>{t("sidebarEmpty")}</div>
  );
}
