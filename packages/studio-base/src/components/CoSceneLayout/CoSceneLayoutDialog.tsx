// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Dialog, DialogProps, DialogTitle, IconButton } from "@mui/material";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

export function CoSceneLayoutDialog(
  props: DialogProps & {
    onClose: () => void;
  },
): React.JSX.Element {
  const { open, onClose } = props;
  const consoleApi = useConsoleApi();

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
    </Dialog>
  );
}
