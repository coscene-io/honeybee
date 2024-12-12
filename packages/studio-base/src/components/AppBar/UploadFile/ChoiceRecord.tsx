// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Button, Dialog, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ChooserComponent } from "@foxglove/studio-base/components/CoSceneChooser";

export function ChoiceRecordDialog({
  open,
  onClose,
  onConfirm,
  defaultRecordName,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (recordName: string) => void;
  defaultRecordName?: string;
}): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const [targetRecordName, setTargetRecordName] = useState<string | undefined>(undefined);

  return (
    <Dialog open={open} onClose={onClose}>
      <Stack pt={2} px={2}>
        <Typography variant="h6">{t("uploadTo")}</Typography>
      </Stack>
      <Stack flex={1}>
        <ChooserComponent
          type="record"
          checkFileSupportedFunc={() => true}
          setTargetRecordName={(record, recordType) => {
            if (recordType === "create") {
              onConfirm(record?.name ?? "");
              onClose();
            } else {
              setTargetRecordName(record?.name);
            }
          }}
          files={[]}
          setFiles={() => {}}
          defaultRecordType="create"
          defaultRecordName={defaultRecordName}
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
              if (targetRecordName != undefined) {
                onConfirm(targetRecordName);
                onClose();
              }
            }}
            variant="contained"
            size="large"
            disabled={targetRecordName == undefined}
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
