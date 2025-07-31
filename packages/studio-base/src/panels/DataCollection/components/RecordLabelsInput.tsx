// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FormControl, InputLabel, Box } from "@mui/material";
import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import { TFunction } from "i18next";
import { memo } from "react";

import RecordLabelSelector from "@foxglove/studio-base/components/RecordInfo/RecordLabelSelector";

interface RecordLabelsInputProps {
  recordLabels: Label[];
  recordLabelOptions: Label[];
  onLabelsChange: (labels: Label[]) => void;
  t: TFunction<"dataCollection">;
}

export const RecordLabelsInput = memo(function RecordLabelsInput({
  recordLabels,
  recordLabelOptions,
  onLabelsChange,
  t,
}: RecordLabelsInputProps) {
  return (
    <Box minWidth={200}>
      <FormControl fullWidth size="small">
        <InputLabel id="record-labels-select-label">{t("recordLabels")}</InputLabel>
        <RecordLabelSelector
          value={recordLabels.map((label) => label.name)}
          options={recordLabelOptions}
          onChange={(_, newValue) => {
            onLabelsChange(newValue);
          }}
          placeholder={t("recordLabels")}
        />
      </FormControl>
    </Box>
  );
});
