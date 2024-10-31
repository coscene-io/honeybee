// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Button, Dialog, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { ChooserComponent } from "@foxglove/studio-base/components/CoSceneChooser";

const useStyles = makeStyles()(() => ({
  dialog: {
    // height: "80%",
    // width: "50%",
  },
}));

export function ChoiceRecordDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (recordName: string) => void;
}): JSX.Element {
  const { t } = useTranslation("appBar");
  const [targetRecordName, setTargetRecordName] = useState<string | undefined>(undefined);
  const { classes } = useStyles();

  return (
    <Dialog open={open} onClose={onClose} className={classes.dialog}>
      <Stack pt={2} px={2}>
        <Typography variant="h6">{t("uploadTo")}</Typography>
      </Stack>
      <Stack flex={1}>
        <ChooserComponent
          type="record"
          checkFileSupportedFunc={() => true}
          setTargetRecordName={(record) => {
            setTargetRecordName(record?.name);
          }}
          files={[]}
          setFiles={() => {}}
          defaultRecordType="create"
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
