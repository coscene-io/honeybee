// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Property } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { FormControl, FormLabel, MenuItem, Select, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { Updater } from "use-immer";

import { CustomFieldValuesFields } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields";
import Stack from "@foxglove/studio-base/components/Stack";
import { BagFileInfo } from "@foxglove/studio-base/context/CoScenePlaylistContext";

import { ImageUpload } from "./ImageUpload";
import { MetadataEditor } from "./MetadataEditor";
import { EventFormData, KeyValue } from "./types";

const useStyles = makeStyles()(() => ({
  requiredFlags: {
    color: "#ff4d4f",
    marginRight: "3px",
  },
}));

interface EventFormProps {
  event: EventFormData;
  isEditing: boolean;
  recordItems: BagFileInfo[];
  customFieldSchema?: { properties: Property[] };
  formattedEventStartTime: string;
  formattedEventEndTime: string;
  isComposition: boolean;
  onEventChange: Updater<EventFormData>;
  onMetaDataKeyDown: (keyboardEvent: React.KeyboardEvent) => void;
}

export function EventForm({
  event,
  isEditing,
  recordItems,
  customFieldSchema,
  formattedEventStartTime,
  formattedEventEndTime,
  isComposition,
  onEventChange,
  onMetaDataKeyDown,
}: EventFormProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("cosEvent");

  const updateMetadata = (index: number, updateType: keyof KeyValue, value: string) => {
    onEventChange((draft) => {
      const keyval = draft.metadataEntries[index];
      if (keyval) {
        keyval[updateType] = value;

        // Automatically add new row if we're at the end and have both key and value.
        if (
          index === draft.metadataEntries.length - 1 &&
          keyval.key.length > 0 &&
          keyval.value.length > 0
        ) {
          draft.metadataEntries.push({ key: "", value: "" });
        }
      }
    });
  };

  const addRow = (index: number) => {
    onEventChange((draft) => {
      draft.metadataEntries.splice(index + 1, 0, { key: "", value: "" });
    });
  };

  const removeRow = (index: number) => {
    onEventChange((draft) => {
      if (draft.metadataEntries.length > 1) {
        draft.metadataEntries.splice(index, 1);
      }
    });
  };

  const handleImageChange = (file?: File) => {
    onEventChange((draft) => {
      if (file) {
        draft.imageFile = file;
        draft.imgUrl = undefined;
      } else {
        draft.imageFile = undefined;
        draft.imgUrl = undefined;
      }
    });
  };

  return (
    <>
      <Stack paddingX={3} paddingTop={2}>
        <TextField
          size="small"
          variant="filled"
          id="event-name"
          label={
            <>
              <span className={classes.requiredFlags}>*</span>
              {t("name")}
            </>
          }
          maxRows={1}
          value={event.eventName}
          onChange={(val) => {
            onEventChange((draft) => {
              draft.eventName = val.target.value;
            });
          }}
          autoFocus
          onKeyDown={onMetaDataKeyDown}
        />
      </Stack>

      <Stack paddingX={3} paddingTop={2}>
        <FormControl>
          <FormLabel>{t("startAndEndTime")}</FormLabel>
          <Typography paddingY={1}>
            <Stack alignItems="center" direction="row" gap={1}>
              {t("startAndEndTimeDesc", {
                startTime: formattedEventStartTime,
                endTime: formattedEventEndTime,
              })}
              {event.duration?.toFixed(3) ?? ""}
              {t("seconds")}
            </Stack>
          </Typography>
        </FormControl>
      </Stack>

      <Stack paddingX={3} paddingTop={2}>
        <TextField
          size="small"
          variant="filled"
          id="description"
          label={t("description")}
          rows={2}
          value={event.description}
          onChange={(val) => {
            onEventChange((draft) => {
              draft.description = val.target.value;
            });
          }}
          onKeyDown={onMetaDataKeyDown}
        />
      </Stack>

      <ImageUpload
        imageFile={event.imageFile}
        imgUrl={event.imgUrl}
        onImageChange={handleImageChange}
      />

      <MetadataEditor
        metadataEntries={event.metadataEntries}
        isComposition={isComposition}
        onUpdateMetadata={updateMetadata}
        onAddRow={addRow}
        onRemoveRow={removeRow}
        onMetaDataKeyDown={onMetaDataKeyDown}
      />

      {!isEditing && (
        <Stack paddingX={3} paddingTop={2}>
          <FormLabel>{t("record")}</FormLabel>
          <Select
            size="small"
            variant="filled"
            value={recordItems[0]?.name ?? ""}
            disabled={recordItems.length <= 1}
            onChange={(e) => {
              onEventChange((draft) => {
                draft.fileName = e.target.value;
              });
            }}
          >
            {recordItems.map((bag) => (
              <MenuItem key={bag.name} value={bag.name}>
                {bag.recordDisplayName}
              </MenuItem>
            ))}
          </Select>
        </Stack>
      )}

      {/* if is edit moment make sure event.customFieldValues is not undefined */}
      {customFieldSchema?.properties && (!isEditing || event.customFieldValues) && (
        <Stack paddingX={3} paddingTop={2} gap={2}>
          {/* custom field */}
          <CustomFieldValuesFields
            variant="secondary"
            properties={customFieldSchema.properties}
            customFieldValues={event.customFieldValues ?? []}
            onChange={(customFieldValues) => {
              onEventChange((draft) => {
                draft.customFieldValues = customFieldValues;
              });
            }}
          />
        </Stack>
      )}
    </>
  );
}
