// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dialog, DialogTitle, DialogContent, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";

export function ImportFromFileDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("copyFromOtherProject")}</DialogTitle>
      <DialogContent>
        <TextField label="布局名称" />
      </DialogContent>
    </Dialog>
  );
}
