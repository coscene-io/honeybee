// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import {
  CustomFieldValueSchema,
  type CustomFieldValue,
  type Property,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CustomFieldValueFieldEditor } from "@foxglove/studio-base/components/CustomFieldProperty/editor/CustomFieldValueFieldEditor";
import type { MomentCustomFieldFilters } from "@foxglove/studio-base/context/EventsContext";

const useStyles = makeStyles()((theme) => ({
  fields: { paddingTop: theme.spacing(1) },
  clear: { marginRight: "auto" },
}));

export function MomentCustomFieldFilterDialog({
  properties,
  filters,
  onApply,
  onClose,
}: {
  properties: readonly Property[];
  filters?: MomentCustomFieldFilters;
  onApply: (filters: MomentCustomFieldFilters) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation(["event", "general"]);
  const { classes } = useStyles();
  const titleId = useId();
  const [draft, setDraft] = useState(() => new Map(filters));
  const [fieldId, setFieldId] = useState(() => properties.find((field) => draft.has(field.id))?.id);
  const property = properties.find((field) => field.id === fieldId) ?? properties[0];
  const fieldValue = property ? draft.get(property.id) : undefined;
  const updateField = (id: string, value: CustomFieldValue["value"]) => {
    setDraft((previous) => {
      const next = new Map(previous);
      if (value.case == undefined || (value.case === "user" && value.value.ids.length === 0)) {
        next.delete(id);
      } else {
        next.set(id, value);
      }
      return next;
    });
  };

  return (
    <Dialog open fullWidth maxWidth="xs" aria-labelledby={titleId} onClose={onClose}>
      <DialogTitle id={titleId}>{t("filterCustomFields")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className={classes.fields}>
          <TextField
            select
            fullWidth
            size="small"
            label={t("customFieldFilterField")}
            value={property?.id ?? ""}
            onChange={(event) => {
              setFieldId(event.target.value);
            }}
          >
            {properties.map((field) => (
              <MenuItem key={field.id} value={field.id}>
                {draft.has(field.id)
                  ? t("customFieldFilterActive", { field: field.name })
                  : field.name}
              </MenuItem>
            ))}
          </TextField>
          {property && (
            <CustomFieldValueFieldEditor
              key={property.id}
              customFieldValue={create(CustomFieldValueSchema, {
                property: { ...property, required: false },
                value: fieldValue,
              })}
              onChange={(field) => {
                updateField(property.id, field.value);
              }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          className={classes.clear}
          disabled={draft.size === 0}
          onClick={() => {
            setDraft(new Map());
          }}
        >
          {t("clearCustomFieldFilters")}
        </Button>
        <Button onClick={onClose}>{t("general:cancel")}</Button>
        <Button
          variant="contained"
          onClick={() => {
            onApply(draft);
          }}
        >
          {t("general:apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
