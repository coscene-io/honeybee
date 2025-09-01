// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Dialog, DialogProps, DialogTitle, IconButton } from "@mui/material";
import _ from "lodash";
import _uniq from "lodash/uniq";
import { useEffect } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

import { CoSceneLayoutContent } from "./CoSceneLayoutContent";

const log = Logger.getLogger(__filename);

export function CoSceneLayoutDialogContent(): React.JSX.Element {
  const layoutManager = useLayoutManager();

  const [layouts, reloadLayouts] = useAsyncFn(
    async () => {
      const layouts = await layoutManager.getLayouts();
      const [projectLayouts, personalLayouts] = _.partition(
        layouts,
        layoutManager.supportsSharing ? layoutIsShared : () => false,
      );
      return {
        layouts: [...layouts].sort((a, b) => a.displayName.localeCompare(b.displayName)),
        personalFolders: _uniq(
          personalLayouts.map((layout) => layout.folder).filter((folder) => folder),
        ),
        projectFolders: _uniq(
          projectLayouts.map((layout) => layout.folder).filter((folder) => folder),
        ),
        personalLayouts: personalLayouts.sort((a, b) => a.displayName.localeCompare(b.displayName)),
        projectLayouts: projectLayouts.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      };
    },
    [layoutManager],
    { loading: true },
  );

  useEffect(() => {
    const listener = () => void reloadLayouts();
    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [layoutManager, reloadLayouts]);

  // Start loading on first mount
  useEffect(() => {
    reloadLayouts().catch((err: unknown) => {
      log.error(err);
    });
  }, [reloadLayouts]);

  return <CoSceneLayoutContent layouts={layouts.value} />;
}

export function CoSceneLayoutDialog(
  props: DialogProps & {
    onClose: () => void;
  },
): React.JSX.Element {
  const { open, onClose } = props;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>
        CoScene Layout
        <IconButton
          component="button"
          onClick={() => {
            onClose();
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <CoSceneLayoutDialogContent />
    </Dialog>
  );
}
