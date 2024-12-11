// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Record as Record_es } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { Button, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

const useStyles = makeStyles()(() => ({
  textField: {
    width: "400px",
  },
}));

export function CreateRecordForm({
  parent,
  onCreated,
  defaultRecordName,
  createRecordConfirmText,
}: {
  parent: string;
  onCreated: (record: Record_es) => void;
  defaultRecordName?: string;
  createRecordConfirmText?: string;
}): React.JSX.Element {
  const cosceneApi = useConsoleApi();
  const [recordName, setRecordName] = useState(defaultRecordName ?? "");
  const [recordDescription, setRecordDescription] = useState("");
  const { classes } = useStyles();

  const { t } = useTranslation("appBar");

  const handleCreateRecord = async () => {
    const targetRecord = await cosceneApi.createRecord({
      parent,
      record: {
        title: recordName,
        description: recordDescription,
      },
    });

    onCreated(targetRecord);
  };

  return (
    <Stack gap={2}>
      <Typography variant="h6">{t("createRecord")}</Typography>
      <TextField
        label={t("recordName")}
        value={recordName}
        onChange={(e) => {
          setRecordName(e.target.value);
        }}
        className={classes.textField}
      />
      <TextField
        label={t("recordDescription")}
        value={recordDescription}
        onChange={(e) => {
          setRecordDescription(e.target.value);
        }}
        className={classes.textField}
      />
      <Button
        onClick={() => {
          void handleCreateRecord();
        }}
        variant="contained"
      >
        {createRecordConfirmText ?? t("create")}
      </Button>
    </Stack>
  );
}
