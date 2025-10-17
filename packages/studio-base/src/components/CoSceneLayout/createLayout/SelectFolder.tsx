// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TextField, Autocomplete } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function SelectFolder({
  folders,
  onChange,
  value,
}: {
  folders: string[];
  onChange: (args: { value: string; isNewFolder: boolean }) => void;
  value: { value: string; isNewFolder: boolean };
}): React.JSX.Element {
  const { t } = useTranslation(["cosLayout", "general"]);

  const options: { label: string; value: string; isNewFolder: boolean }[] = useMemo(() => {
    return [
      ...folders.map((folder) => ({ label: folder, value: folder, isNewFolder: false })),
      { label: t("createNewFolder"), value: "", isNewFolder: true },
    ];
  }, [t, folders]);

  const selectedOption = options.find((option) =>
    value.isNewFolder ? option.isNewFolder : option.value === value.value && !option.isNewFolder,
  );

  return (
    <>
      <Autocomplete
        options={options}
        value={selectedOption ?? null} // eslint-disable-line no-restricted-syntax
        onChange={(_, option) => {
          onChange({
            value: option?.value ?? "",
            isNewFolder: option?.isNewFolder ?? false,
          });
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t("folder")}
            placeholder={t("pleaseSelect", { ns: "general" })}
          />
        )}
      />
      {value.isNewFolder && (
        <TextField
          label={t("folder")}
          slotProps={{ htmlInput: { maxLength: 60 } }}
          value={value.value}
          onChange={(e) => {
            onChange({
              value: e.target.value,
              isNewFolder: true,
            });
          }}
        />
      )}
    </>
  );
}
