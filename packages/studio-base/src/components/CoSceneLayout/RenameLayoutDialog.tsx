// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  Button,
  DialogActions,
  Stack,
} from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

export function RenameLayoutDialog({
  open,
  onClose,
  onRenameLayout,
  layout,
}: {
  open: boolean;
  onClose: () => void;
  onRenameLayout: (layout: Layout, newName: string) => void;
  layout: Layout;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");

  const form = useForm({
    defaultValues: { newName: layout.displayName },
  });

  const onSubmit = (data: { newName: string }) => {
    onRenameLayout(layout, data.newName);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("rename")}</DialogTitle>
      <DialogContent>
        <Stack gap={2}>
          <Controller
            control={form.control}
            name="newName"
            rules={{
              required: true,
            }}
            render={({ field }) => <TextField required label={t("layoutName")} {...field} />}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t("cancel", { ns: "cosGeneral" })}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            void form.handleSubmit(onSubmit)();
          }}
        >
          {t("ok", { ns: "cosGeneral" })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
