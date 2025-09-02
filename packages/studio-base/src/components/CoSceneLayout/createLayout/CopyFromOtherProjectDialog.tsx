// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Dialog,
  DialogTitle,
  DialogContent,
  Button,
  DialogActions,
  Input,
  FormControl,
  InputLabel,
} from "@mui/material";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

export function CopyFromOtherProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");

  const form = useForm({ defaultValues: { displayName: "" } });

  const onSubmit = (data: any) => {
    // console.log(data);
    console.log(data);
  };

  return (
    <Dialog maxWidth="md" fullWidth open={open} onClose={onClose}>
      <DialogTitle>{t("copyFromOtherProject")}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth>
          <InputLabel required id="project-select-label">
            {t("projectName")}
          </InputLabel>
          <Input {...form.register("displayName")} />
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t("cancel", { ns: "cosGeneral" })}
        </Button>
        <Button
          onClick={() => {
            form.handleSubmit(onSubmit);
          }}
        >
          {t("ok", { ns: "cosGeneral" })}
        </Button>{" "}
      </DialogActions>
    </Dialog>
  );
}
