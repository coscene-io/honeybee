// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FormControl, FormHelperText, FormLabel, MenuItem, Stack, TextField } from "@mui/material";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import type { FieldRef } from "@mui/x-date-pickers/models";
import type { Dayjs } from "dayjs";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import type { NumberFilterDraft, TimeFilterDraft } from "./momentFilterDraft";

const NUMBER_OPERATORS = ["between", "=", "!=", ">=", ">", "<=", "<"] as const;
const COMPARISON_STYLE = { minWidth: 120 };

export function MomentNumberFilterEditor({
  name,
  draft,
  error,
  onChange,
}: {
  name: string;
  draft: NumberFilterDraft;
  error?: string;
  onChange: (draft: NumberFilterDraft) => void;
}): React.JSX.Element {
  const { t } = useTranslation("event");
  const between = draft.operator === "between";
  return (
    <FormControl error={error != undefined}>
      <FormLabel>{name}</FormLabel>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          select
          size="small"
          label={t("filterComparison")}
          value={draft.operator}
          style={COMPARISON_STYLE}
          onChange={(event) => {
            const operator = NUMBER_OPERATORS.find((value) => value === event.target.value);
            if (operator != undefined) {
              onChange({ ...draft, operator });
            }
          }}
        >
          {NUMBER_OPERATORS.map((operator) => (
            <MenuItem key={operator} value={operator}>
              {operator === "between" ? t("filterBetween") : operator}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          fullWidth
          size="small"
          variant="filled"
          label={t(between ? "filterMinimum" : "value")}
          value={draft.first}
          slotProps={{ htmlInput: { inputMode: "decimal" } }}
          onChange={(event) => {
            onChange({ ...draft, first: event.target.value });
          }}
        />
        {between && (
          <TextField
            fullWidth
            size="small"
            variant="filled"
            label={t("filterMaximum")}
            value={draft.second}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            onChange={(event) => {
              onChange({ ...draft, second: event.target.value });
            }}
          />
        )}
      </Stack>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
}

export function MomentTimeFilterEditor({
  name,
  draft,
  error,
  onChange,
}: {
  name: string;
  draft: TimeFilterDraft;
  error?: string;
  onChange: (draft: TimeFilterDraft) => void;
}): React.JSX.Element {
  const { t } = useTranslation("event");
  return (
    <FormControl error={error != undefined}>
      <FormLabel>{name}</FormLabel>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {(["start", "end"] as const).map((bound) => (
          <DateTimeBoundEditor
            key={bound}
            label={t(bound === "start" ? "startTime" : "filterEndTime")}
            bound={draft[bound]}
            onChange={(next) => {
              onChange({ ...draft, [bound]: next });
            }}
          />
        ))}
      </Stack>
      <FormHelperText>{error ?? t("filterTimeRangeHint")}</FormHelperText>
    </FormControl>
  );
}

function DateTimeBoundEditor({
  label,
  bound,
  onChange,
}: {
  label: string;
  bound: TimeFilterDraft["start"];
  onChange: (bound: TimeFilterDraft["start"]) => void;
}): React.JSX.Element {
  const { t } = useTranslation("general");
  const fieldRef = useRef<FieldRef<Dayjs | ReactNull>>(ReactNull);
  return (
    <DateTimePicker
      label={label}
      ampm={false}
      format="YYYY-MM-DD HH:mm"
      desktopModeMediaQuery="@media (min-width: 600px) and (pointer: fine)"
      timeSteps={{ minutes: 1 }}
      value={bound.value}
      onChange={(value, context) => {
        onChange({ value, invalid: context.validationError != undefined });
      }}
      localeText={{ clearButtonLabel: t("clearButtonLabel"), okButtonLabel: t("okButtonLabel") }}
      slotProps={{
        textField: {
          fullWidth: true,
          variant: "filled",
          size: "small",
          onBlur: (event) => {
            if (event.currentTarget.contains(event.relatedTarget)) {
              return;
            }
            // The picker publishes null when a date has only some sections filled.
            const sections = fieldRef.current?.getSections() ?? [];
            const incomplete =
              sections.some((section) => section.value !== "") &&
              sections.some((section) => section.value === "");
            if (incomplete !== (bound.incomplete ?? false)) {
              onChange({ ...bound, incomplete });
            }
          },
        },
        field: {
          clearable: true,
          fieldRef,
          onClear: () => {
            onChange({ value: ReactNull });
          },
        },
        openPickerButton: { size: "small" },
        actionBar: { actions: ["clear", "accept"] },
      }}
    />
  );
}
