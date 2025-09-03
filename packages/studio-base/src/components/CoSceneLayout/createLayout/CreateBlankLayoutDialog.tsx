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
  Select,
  MenuItem,
} from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { LayoutPermission } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

interface CreateBlankLayoutForm {
  displayName: string;
  folder: string;
  permission: LayoutPermission;
}

export function CreateBlankLayoutDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const layoutManager = useLayoutManager();

  const form = useForm<CreateBlankLayoutForm>({
    defaultValues: { displayName: "", folder: "", permission: "CREATOR_WRITE" },
  });

  const onSubmit = async (data: CreateBlankLayoutForm) => {
    await layoutManager
      .saveNewLayout({
        folder: data.folder,
        displayName: data.displayName,
        data: {
          configById: {},
          globalVariables: {},
          userNodes: {},
        },
        permission: data.permission,
      })
      .then(() => {
        onClose();
      });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("createBlankLayout")}</DialogTitle>
      <DialogContent>
        <Stack gap={2}>
          <Controller
            control={form.control}
            name="displayName"
            rules={{
              required: true,
            }}
            render={({ field }) => <TextField required label={t("layoutName")} {...field} />}
          />
          <Controller
            control={form.control}
            name="permission"
            render={({ field }) => (
              <Select label={t("type")} {...field}>
                <MenuItem value="CREATOR_WRITE">{t("personalLayout")}</MenuItem>
                <MenuItem value="ORG_WRITE">{t("projectLayout")}</MenuItem>
              </Select>
            )}
          />
          <Controller
            control={form.control}
            name="folder"
            render={({ field }) => <TextField label={t("folder")} {...field} />}
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
