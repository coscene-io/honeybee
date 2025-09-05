// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TextField, Autocomplete } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export function SelectFolder({
  value,
  type,
  onChange,
}: {
  value: string;
  type: "personal" | "project";
  onChange: (value?: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const [selectedFolder, setSelectedFolder] = useState<
    { label: string; value: string } | undefined
  >(undefined);
  const [newFolderName, setNewFolderName] = useState("");

  const options: { label: string; value: string }[] = useMemo(() => {
    return [
      { label: t("createNewFolder"), value: "" },
      { label: t("personalLayout"), value: "personal" },
      { label: t("projectLayout"), value: "project" },
    ];
  }, [t]);

  useEffect(() => {
    setSelectedFolder(undefined);
    setNewFolderName("");
  }, [type]);

  useEffect(() => {
    onChange(selectedFolder?.value === "" ? newFolderName : selectedFolder?.value);
  }, [selectedFolder, newFolderName, onChange]);

  return (
    <>
      <Autocomplete
        options={options}
        value={selectedFolder}
        onChange={(_, option) => {
          setSelectedFolder(option ?? undefined);
          if (option?.value !== "") {
            setNewFolderName("");
          }
        }}
        renderInput={(params) => <TextField {...params} label={t("folder")} />}
      />
      {selectedFolder?.value === "" && (
        <TextField
          label={t("folder")}
          value={newFolderName}
          onChange={(e) => {
            setNewFolderName(e.target.value);
          }}
        />
      )}
    </>
  );
}
