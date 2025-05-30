// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import HelpIcon from "@mui/icons-material/Help";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  ButtonGroup,
  FormLabel,
  IconButton,
  MenuItem,
  Select,
  TextField,
  Tooltip,
} from "@mui/material";
import * as _ from "lodash-es";
import { useTranslation } from "react-i18next";
import { keyframes } from "tss-react";
import { makeStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";

import { PIVOT_METRIC, pivotMetricValues } from "./constants";
import { KeyValue } from "./types";
import { invokeTabKey } from "./utils";

const fadeInAnimation = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const useStyles = makeStyles()((theme) => ({
  grid: {
    alignItems: "center",
    display: "grid",
    gridTemplateColumns: "1fr 1fr auto",
    gap: theme.spacing(1),
    overflow: "auto",
    alignContent: "flex-start",
  },
  row: {
    animation: `${fadeInAnimation} 0.2s ease-in-out`,
    display: "contents",
  },
}));

interface MetadataEditorProps {
  metadataEntries: KeyValue[];
  isComposition: boolean;
  onUpdateMetadata: (index: number, updateType: keyof KeyValue, value: string) => void;
  onAddRow: (index: number) => void;
  onRemoveRow: (index: number) => void;
  onMetaDataKeyDown: (keyboardEvent: React.KeyboardEvent) => void;
}

export function MetadataEditor({
  metadataEntries,
  isComposition,
  onUpdateMetadata,
  onAddRow,
  onRemoveRow,
  onMetaDataKeyDown,
}: MetadataEditorProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("cosEvent");
  const isSupor = getDomainConfig().logo === "supor";

  const countedMetadata = _.countBy(metadataEntries, (kv) => kv.key);

  return (
    <Stack paddingX={3} paddingTop={2}>
      <FormLabel>{t("attribute")}</FormLabel>
      <div className={classes.grid}>
        {isSupor ? (
          <div className={classes.row}>
            <div>
              {PIVOT_METRIC}{" "}
              <Tooltip placement="top-start" title={t("pivotMetricTooltip")}>
                <IconButton>
                  <HelpIcon />
                </IconButton>
              </Tooltip>
            </div>
            <Select
              value={metadataEntries.find((entry) => entry.key === PIVOT_METRIC)?.value ?? ""}
              onChange={(evt) => {
                const existingIndex = metadataEntries.findIndex(
                  (entry) => entry.key === PIVOT_METRIC,
                );
                if (existingIndex >= 0) {
                  onUpdateMetadata(existingIndex, "value", evt.target.value);
                } else {
                  // Add new entry at the beginning
                  onAddRow(-1);
                  onUpdateMetadata(0, "key", PIVOT_METRIC);
                  onUpdateMetadata(0, "value", evt.target.value);
                }
              }}
            >
              {pivotMetricValues.map((item) => (
                <MenuItem key={item} value={item}>
                  {item}
                </MenuItem>
              ))}
            </Select>
            <div>
              {metadataEntries.find((entry) => entry.key === PIVOT_METRIC)?.value && (
                <IconButton
                  onClick={() => {
                    const index = metadataEntries.findIndex((entry) => entry.key === PIVOT_METRIC);
                    if (index >= 0) {
                      onRemoveRow(index);
                    }
                  }}
                >
                  <ClearIcon />
                </IconButton>
              )}
            </div>
          </div>
        ) : (
          metadataEntries.map(({ key, value }, index) => {
            const hasDuplicate = +((key.length > 0 && countedMetadata[key]) ?? 0) > 1;
            return (
              <div className={classes.row} key={index}>
                <TextField
                  size="small"
                  variant="filled"
                  value={key}
                  placeholder={t("attributeKey")}
                  error={hasDuplicate}
                  onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                    if (keyboardEvent.key === "Enter" && !isComposition) {
                      invokeTabKey();
                    }
                  }}
                  onChange={(evt) => {
                    onUpdateMetadata(index, "key", evt.currentTarget.value);
                  }}
                />
                <TextField
                  size="small"
                  variant="filled"
                  value={value}
                  placeholder={t("attributeValue")}
                  error={hasDuplicate}
                  onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                    if (
                      (keyboardEvent.nativeEvent.target as HTMLInputElement).value !== "" &&
                      keyboardEvent.key === "Enter" &&
                      !isComposition
                    ) {
                      onMetaDataKeyDown(keyboardEvent);
                    }
                  }}
                  onChange={(evt) => {
                    onUpdateMetadata(index, "value", evt.currentTarget.value);
                  }}
                />
                <ButtonGroup>
                  <IconButton
                    tabIndex={-1}
                    onClick={() => {
                      onAddRow(index);
                    }}
                  >
                    <AddIcon />
                  </IconButton>
                  <IconButton
                    tabIndex={-1}
                    onClick={() => {
                      onRemoveRow(index);
                    }}
                    style={{
                      visibility: metadataEntries.length > 1 ? "visible" : "hidden",
                    }}
                  >
                    <RemoveIcon />
                  </IconButton>
                </ButtonGroup>
              </div>
            );
          })
        )}
      </div>
    </Stack>
  );
}
