// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import {
  CustomFieldValueSchema,
  type Property,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
  dialogContentClasses,
} from "@mui/material";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CustomFieldValueFieldEditor } from "@foxglove/studio-base/components/CustomFieldProperty/editor/CustomFieldValueFieldEditor";
import type { MomentCustomFieldFilters } from "@foxglove/studio-base/context/EventsContext";

import { MomentNumberFilterEditor, MomentTimeFilterEditor } from "./MomentRangeFilterEditors";
import { createFilterDraft, resolveFilterDraft, type MomentFilterDraft } from "./momentFilterDraft";

const useStyles = makeStyles()((theme) => ({
  condition: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "end",
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1, 1, 1.5),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
  addIcon: {
    marginLeft: theme.spacing(1),
    marginRight: theme.spacing(0.5),
    color: theme.palette.text.secondary,
  },
  actions: {
    flexWrap: "wrap",
    paddingBottom: theme.spacing(1.5),
    [`.${dialogContentClasses.root} + &`]: {
      paddingTop: theme.spacing(1.5),
    },
  },
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
  const hintId = useId();
  const [draft, setDraft] = useState(
    () =>
      new Map(
        Array.from(filters ?? [], ([id, filter]) => [id, createFilterDraft(filter.case, filter)]),
      ),
  );
  const [query, setQuery] = useState("");
  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const conditions = Array.from(draft).flatMap(([id, saved]) => {
    const property = propertiesById.get(id);
    if (property == undefined) {
      return [];
    }
    const value = saved.case === property.type.case ? saved : createFilterDraft(property.type.case);
    return [{ property, value, ...resolveFilterDraft(value, property) }];
  });
  const availableProperties = properties.filter((field) => !draft.has(field.id));

  const updateField = (id: string, value: MomentFilterDraft) => {
    setDraft((previous) => new Map(previous).set(id, value));
  };

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onClose={onClose}
    >
      <DialogTitle id={titleId}>{t("filterCustomFields")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography id={hintId} variant="body2" color="text.secondary">
            {t("customFieldFilterHint")}
          </Typography>
          <Autocomplete
            size="small"
            options={availableProperties}
            value={ReactNull}
            inputValue={query}
            disabled={availableProperties.length === 0}
            getOptionLabel={(property) => property.name}
            getOptionKey={(property) => property.id}
            noOptionsText={t("general:noMatchingItemsFound")}
            onInputChange={(_, value, reason) => {
              setQuery(reason === "input" ? value : "");
            }}
            onChange={(_, property) => {
              if (property != undefined) {
                setDraft(
                  (previous) =>
                    new Map([[property.id, createFilterDraft(property.type.case)], ...previous]),
                );
                setQuery("");
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={
                  availableProperties.length > 0
                    ? t("addCustomFieldFilter")
                    : t("allCustomFieldFiltersAdded")
                }
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps.input,
                    startAdornment: <AddIcon className={classes.addIcon} fontSize="small" />,
                  },
                  htmlInput: {
                    ...params.slotProps.htmlInput,
                    "aria-label": t("addCustomFieldFilter"),
                  },
                }}
              />
            )}
          />
          {conditions.map(({ property, value, error }) => {
            const removeLabel = t("removeCustomFieldFilter", { field: property.name });
            return (
              <div
                key={property.id}
                className={classes.condition}
                role="group"
                aria-label={property.name}
              >
                {value.case === "number" ? (
                  <MomentNumberFilterEditor
                    name={property.name}
                    draft={value}
                    error={error == undefined ? undefined : t(error)}
                    onChange={(next) => {
                      updateField(property.id, next);
                    }}
                  />
                ) : value.case === "time" ? (
                  <MomentTimeFilterEditor
                    name={property.name}
                    draft={value}
                    error={error == undefined ? undefined : t(error)}
                    onChange={(next) => {
                      updateField(property.id, next);
                    }}
                  />
                ) : (
                  <CustomFieldValueFieldEditor
                    key={property.type.case}
                    customFieldValue={create(CustomFieldValueSchema, {
                      property: { ...property, required: false },
                      value,
                    })}
                    onChange={({ value: next }) => {
                      if (next.case !== "number" && next.case !== "time") {
                        updateField(property.id, next);
                      }
                    }}
                  />
                )}
                <IconButton
                  size="small"
                  aria-label={removeLabel}
                  title={removeLabel}
                  onClick={() => {
                    setDraft((previous) => {
                      const next = new Map(previous);
                      next.delete(property.id);
                      return next;
                    });
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </div>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions className={classes.actions}>
        <Button
          className={classes.clear}
          size="small"
          color="inherit"
          disabled={conditions.length === 0}
          onClick={() => {
            setDraft(new Map());
          }}
        >
          {t("clearCustomFieldFilters")}
        </Button>
        <Button onClick={onClose}>{t("general:cancel")}</Button>
        <Button
          variant="contained"
          disabled={conditions.some(({ error }) => error != undefined)}
          onClick={() => {
            onApply(
              new Map(
                conditions.flatMap(({ property, filter }) =>
                  filter == undefined ? [] : [[property.id, filter] as const],
                ),
              ),
            );
          }}
        >
          {t("applyMomentFilters")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
