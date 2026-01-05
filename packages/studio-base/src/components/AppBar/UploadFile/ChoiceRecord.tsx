// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Project } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { Button, Dialog, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ChooserComponent } from "@foxglove/studio-base/components/CoSceneChooser/ChooserComponent";

export function ChoiceRecordDialog({
  open,
  onClose,
  onConfirm,
  defaultRecordDisplayName,
  mode = "create-record",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (record: Record, project: Project) => void;
  defaultRecordDisplayName?: string;
  mode?: "select-record" | "create-record";
}): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const [targetRecord, setTargetRecord] = useState<Record | undefined>(undefined);
  const [targetProject, setTargetProject] = useState<Project | undefined>(undefined);

  return (
    <Dialog open={open} onClose={onClose}>
      <Stack pt={2} px={2}>
        <Typography variant="h6">{t("uploadTo")}</Typography>
      </Stack>
      <Stack flex={1}>
        <ChooserComponent
          mode={mode}
          checkFileSupportedFunc={() => true}
          setTargetInfo={({ record, project, isCreating }) => {
            if (isCreating === true && record != undefined && project != undefined) {
              onConfirm(record, project);
              onClose();
            } else {
              setTargetRecord(record);
              setTargetProject(project);
            }
          }}
          files={[]}
          setFiles={() => {}}
          defaultRecordDisplayName={defaultRecordDisplayName}
          createRecordConfirmText={t("createRecordAndUpload")}
        />
        <Stack direction="row" justifyContent="flex-end" paddingX={2} paddingBottom={2} gap={1}>
          <Button variant="outlined" size="large" color="inherit" onClick={onClose}>
            {t("cancel", {
              ns: "cosGeneral",
            })}
          </Button>
          <Button
            onClick={() => {
              if (targetRecord != undefined && targetProject != undefined) {
                onConfirm(targetRecord, targetProject);
                onClose();
              }
            }}
            variant="contained"
            size="large"
            disabled={targetRecord == undefined || targetProject == undefined}
          >
            {t("ok", {
              ns: "cosGeneral",
            })}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
