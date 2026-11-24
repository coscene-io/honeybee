// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { Property } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Chip, chipClasses } from "@mui/material";
import dayjs from "dayjs";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { formatMomentFieldValue } from "@foxglove/studio-base/components/PlaybackControls/momentFieldValues";
import { useMomentUserNames } from "@foxglove/studio-base/components/PlaybackControls/useMomentFieldFormat";
import type { MomentCustomFieldFilters } from "@foxglove/studio-base/context/EventsContext";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexWrap: "wrap",
    flexShrink: 0,
    alignContent: "flex-start",
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.75, 1),
    maxHeight: theme.spacing(11),
    overflowY: "auto",
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  chip: {
    [`& .${chipClasses.deleteIcon}`]: {
      color: theme.palette.text.secondary,
    },
  },
}));

const formatFilterTime = (value: Timestamp) =>
  dayjs(timestampDate(value)).format("YYYY-MM-DD HH:mm");

export function MomentFilterChips({
  projectName,
  properties,
  filters,
  doubtfulOnly,
  onEdit,
  onRemove,
  onRemoveDoubtful,
}: {
  projectName?: string;
  properties: readonly Property[];
  filters?: MomentCustomFieldFilters;
  doubtfulOnly: boolean;
  onEdit: () => void;
  onRemove: (id: string) => void;
  onRemoveDoubtful: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("event");
  const userIds = useMemo(
    () =>
      Array.from(filters?.values() ?? []).flatMap((value) =>
        value.case === "user" ? value.value.ids : [],
      ),
    [filters],
  );
  const userNames = useMomentUserNames(userIds, projectName);

  return (
    <div className={classes.root} role="group" aria-label={t("activeMomentFilters")}>
      {doubtfulOnly && (
        <Chip
          className={classes.chip}
          label={t("doubtful")}
          size="small"
          variant="outlined"
          onDelete={onRemoveDoubtful}
        />
      )}
      {properties.map((property) => {
        const value = filters?.get(property.id);
        if (value == undefined) {
          return undefined;
        }
        const display = formatMomentFieldValue({ value }, property, {
          userNames,
          formatTime: formatFilterTime,
        });
        const label = display == undefined ? property.name : `${property.name}: ${display}`;
        return (
          <Chip
            key={property.id}
            className={classes.chip}
            size="small"
            variant="outlined"
            label={label}
            title={label}
            aria-haspopup="dialog"
            onClick={onEdit}
            onDelete={() => {
              onRemove(property.id);
            }}
          />
        );
      })}
    </div>
  );
}
