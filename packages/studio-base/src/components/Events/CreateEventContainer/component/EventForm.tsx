// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import HelpIcon from "@mui/icons-material/Help";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Button,
  TextField,
  Typography,
  FormLabel,
  FormControl,
  IconButton,
  ButtonGroup,
  Select,
  MenuItem,
  Tooltip,
} from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { UseFormReturn, Controller, useFieldArray } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { add, fromSec, fromDate } from "@foxglove/rostime";
import {
  CustomFieldValuesForm,
  FormWithCustomFieldValues,
} from "@foxglove/studio-base/components/CustomFieldProperty/form/CustomFieldValuesForm";
import {
  useGetPassingFile,
  useTimeRange,
} from "@foxglove/studio-base/components/Events/CreateEventContainer/hooks";
import Stack from "@foxglove/studio-base/components/Stack";
import { BagFileInfo } from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { useEvents, EventsStore } from "@foxglove/studio-base/context/EventsContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";

import { CreateEventForm } from "../types";

const useStyles = makeStyles()((theme, _params) => ({
  grid: {
    alignItems: "center",
    display: "grid",
    gridTemplateColumns: "1fr 1fr auto",
    gap: theme.spacing(1),
    overflow: "auto",
    alignContent: "flex-start",
  },
  row: {
    display: "contents",
  },
  requiredFlags: {
    color: "#ff4d4f",
    marginRight: "3px",
  },
  addFileButton: {
    display: "flex",
    gap: theme.spacing(0.5),
    whiteSpace: "nowrap",
  },
}));

const PIVOT_METRIC = "pivotMetric";
const temperature = [...new Array(9).keys()].map((i) => `温度0${i + 1}`);
const pivotMetricValues = ["General", "功率", "压力", "转速", "风速", ...temperature, "温度10"];

interface EventFormProps {
  form: UseFormReturn<CreateEventForm>;
  onMetaDataKeyDown?: (keyboardEvent: React.KeyboardEvent) => void;
}

const selectCustomFieldSchema = (store: EventsStore) => store.customFieldSchema;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;

export function EventForm({ form, onMetaDataKeyDown }: EventFormProps): React.ReactNode {
  const { classes } = useStyles();
  const { t } = useTranslation("cosEvent");
  const { formatTime } = useAppTimeFormat();
  const inputRef = useRef<HTMLInputElement>(ReactNull);
  const [isComposition, setIsComposition] = useState(false);

  const customFieldSchema = useEvents(selectCustomFieldSchema);
  const toModifyEvent = useEvents(selectToModifyEvent);
  const { control, watch, setValue } = form;
  const watchedValues = watch();
  const [imageObjectUrl, setImageObjectUrl] = useState<string | undefined>(undefined);

  const { startTime, duration } = useTimeRange(watchedValues.fileName);

  // 使用 useFieldArray 管理 metadataEntries
  const { fields, append, remove, update } = useFieldArray({
    control,
    name: "metadataEntries",
  });

  // 辅助函数：获取字段值
  const getFieldValue = useCallback(
    (index: number, field: "key" | "value"): string => {
      return watch(`metadataEntries.${index}.${field}`) || "";
    },
    [watch],
  );

  // 辅助函数：查找 PIVOT_METRIC 的索引
  const getPivotMetricIndex = useCallback(() => {
    return fields.findIndex((_, index) => getFieldValue(index, "key") === PIVOT_METRIC);
  }, [fields, getFieldValue]);

  const isSupor = getDomainConfig().logo === "supor";
  const isEditing = toModifyEvent != undefined;

  const passingFile = useGetPassingFile();

  const recordItems = useMemo(() => {
    const tempRecordItems: BagFileInfo[] = [];
    passingFile?.forEach((ele) => {
      if (
        tempRecordItems.find((item) => ele.recordDisplayName === item.recordDisplayName) ==
        undefined
      ) {
        tempRecordItems.push(ele);
      }
    });
    return tempRecordItems;
  }, [passingFile]);

  useEffect(() => {
    const handleCompositionStart = () => {
      setIsComposition(true);
    };
    const handleCompositionEnd = () => {
      setIsComposition(false);
    };

    document.addEventListener("compositionstart", handleCompositionStart);
    document.addEventListener("compositionend", handleCompositionEnd);

    return () => {
      document.removeEventListener("compositionstart", handleCompositionStart);
      document.removeEventListener("compositionend", handleCompositionEnd);
    };
  }, []);

  useEffect(() => {
    setValue("startTime", startTime);
    setValue("duration", duration);
  }, [startTime, duration, setValue]);

  // 管理图片URL的生命周期 - 使用data URL以符合CSP策略
  useEffect(() => {
    if (watchedValues.imageFile) {
      const reader = new FileReader();
      let isActive = true;

      reader.onload = (e) => {
        // 只有当前effect仍然有效时才更新状态，防止竞态条件
        if (isActive) {
          setImageObjectUrl(e.target?.result as string);
        }
      };

      reader.onerror = () => {
        if (isActive) {
          setImageObjectUrl(undefined);
        }
      };

      reader.readAsDataURL(watchedValues.imageFile);

      // 清理函数：取消进行中的FileReader操作
      return () => {
        isActive = false;
        if (reader.readyState === FileReader.LOADING) {
          reader.abort();
        }
      };
    } else {
      setImageObjectUrl(undefined);
      // 返回一个空的清理函数以保持代码路径一致
      return () => {};
    }
  }, [watchedValues.imageFile]);

  // 自动添加新行的逻辑
  const handleAutoAppendRow = useCallback(
    (index: number) => {
      // 只在最后一行且 key 和 value 都有值时自动添加新行
      if (index === fields.length - 1) {
        const currentKey = getFieldValue(index, "key");
        const currentValue = getFieldValue(index, "value");
        if (currentKey.length > 0 && currentValue.length > 0) {
          append({ key: "", value: "" });
        }
      }
    },
    [fields.length, getFieldValue, append],
  );

  const addMetadataRow = useCallback(
    (_index: number) => {
      append({ key: "", value: "" });
    },
    [append],
  );

  const removeMetadataRow = useCallback(
    (index: number) => {
      if (fields.length > 1) {
        remove(index);
      }
    },
    [fields.length, remove],
  );

  const countedMetadata = _.countBy(fields.map((_, index) => getFieldValue(index, "key")));
  const duplicateKey = Object.entries(countedMetadata).find(
    ([key, count]) => key.length > 0 && count > 1,
  );

  const formattedEventStartTime = watchedValues.startTime
    ? formatTime(fromDate(watchedValues.startTime))
    : "-";
  const formattedEventEndTime = watchedValues.startTime
    ? formatTime(add(fromDate(watchedValues.startTime), fromSec(watchedValues.duration ?? 0)))
    : "-";

  const invokeTabKey = () => {
    let currInput = document.activeElement;
    if (currInput?.tagName.toLowerCase() === "input") {
      const inputs = document.getElementsByTagName("input");
      currInput = document.activeElement;
      for (let i = 0; i < inputs.length; i++) {
        if (inputs[i] === currInput) {
          const next = inputs[i + 1];
          if (next?.focus) {
            next.focus();
          }
          break;
        }
      }
    }
  };

  return (
    <Stack>
      <Stack paddingTop={2}>
        <Controller
          name="eventName"
          control={control}
          rules={{
            required: true,
          }}
          render={({ field, fieldState }) => (
            <TextField
              {...field}
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
              autoFocus
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
              onKeyDown={onMetaDataKeyDown}
            />
          )}
        />
      </Stack>

      <Stack paddingTop={2}>
        <FormControl>
          <FormLabel>{t("startAndEndTime")}</FormLabel>
          <Typography paddingY={1}>
            <Stack alignItems="center" direction="row" gap={1}>
              {t("startAndEndTimeDesc", {
                startTime: formattedEventStartTime,
                endTime: formattedEventEndTime,
              })}
              {watchedValues.duration?.toFixed(3) ?? ""}
              {t("seconds")}
            </Stack>
          </Typography>
        </FormControl>
      </Stack>

      <Stack paddingTop={2}>
        <Controller
          name="description"
          control={control}
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              size="small"
              variant="filled"
              id="description"
              label={t("description")}
              rows={2}
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
              onKeyDown={onMetaDataKeyDown}
            />
          )}
        />
      </Stack>

      <Stack paddingTop={2} gap={1}>
        <FormLabel>{t("photo")}</FormLabel>
        {watchedValues.imageFile && imageObjectUrl ? (
          <Stack>
            <img
              onClick={() => inputRef.current?.click()}
              src={imageObjectUrl}
              style={{
                maxHeight: "200px",
                objectFit: "contain",
                cursor: "pointer",
              }}
              alt="Event"
            />
          </Stack>
        ) : (
          watchedValues.imgUrl && (
            <Stack>
              <img
                onClick={() => inputRef.current?.click()}
                src={watchedValues.imgUrl}
                style={{
                  maxHeight: "200px",
                  objectFit: "contain",
                  cursor: "pointer",
                }}
                alt="Event"
              />
            </Stack>
          )
        )}

        {watchedValues.imgUrl || watchedValues.imageFile ? (
          <Button
            className={classes.addFileButton}
            onClick={() => {
              setImageObjectUrl(undefined);
              setValue("imgUrl", undefined);
              setValue("imageFile", undefined);
            }}
          >
            <DeleteForeverIcon />
            {t("delete", { ns: "cosGeneral" })}
          </Button>
        ) : (
          <Button className={classes.addFileButton} onClick={() => inputRef.current?.click()}>
            <AddIcon />
            {t("addPhoto")}
          </Button>
        )}
        <input
          hidden
          ref={inputRef}
          type="file"
          accept="image/*"
          value=""
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setValue("imgUrl", undefined);
              setValue("imageFile", file);
            }
          }}
        />
      </Stack>

      <Stack paddingTop={2}>
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
                value={
                  getPivotMetricIndex() >= 0 ? getFieldValue(getPivotMetricIndex(), "value") : ""
                }
                onChange={(evt) => {
                  const pivotIndex = getPivotMetricIndex();
                  if (pivotIndex >= 0) {
                    update(pivotIndex, { key: PIVOT_METRIC, value: evt.target.value });
                  } else {
                    append({ key: PIVOT_METRIC, value: evt.target.value });
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
                {getPivotMetricIndex() >= 0 && (
                  <IconButton
                    onClick={() => {
                      const pivotIndex = getPivotMetricIndex();
                      if (pivotIndex >= 0) {
                        remove(pivotIndex);
                      }
                    }}
                  >
                    <ClearIcon />
                  </IconButton>
                )}
              </div>
            </div>
          ) : (
            fields.map((field, index) => {
              const fieldKey = getFieldValue(index, "key");
              const hasDuplicate = +((fieldKey.length > 0 && countedMetadata[fieldKey]) ?? 0) > 1;
              return (
                <div className={classes.row} key={field.id}>
                  <Controller
                    name={`metadataEntries.${index}.key`}
                    control={control}
                    render={({ field: keyField }) => (
                      <TextField
                        {...keyField}
                        size="small"
                        variant="filled"
                        placeholder={t("attributeKey")}
                        error={hasDuplicate}
                        onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                          if (keyboardEvent.key === "Enter" && !isComposition) {
                            invokeTabKey();
                          }
                        }}
                        onChange={(evt) => {
                          keyField.onChange(evt);
                          // 延迟检查是否需要自动添加新行
                          setTimeout(() => {
                            handleAutoAppendRow(index);
                          }, 0);
                        }}
                      />
                    )}
                  />
                  <Controller
                    name={`metadataEntries.${index}.value`}
                    control={control}
                    render={({ field: valueField }) => (
                      <TextField
                        {...valueField}
                        size="small"
                        variant="filled"
                        placeholder={t("attributeValue")}
                        error={hasDuplicate}
                        onKeyDown={(keyboardEvent: React.KeyboardEvent) => {
                          if (
                            (keyboardEvent.nativeEvent.target as HTMLInputElement).value !== "" &&
                            keyboardEvent.key === "Enter" &&
                            !isComposition &&
                            onMetaDataKeyDown
                          ) {
                            onMetaDataKeyDown(keyboardEvent);
                          }
                        }}
                        onChange={(evt) => {
                          valueField.onChange(evt);
                          // 延迟检查是否需要自动添加新行
                          setTimeout(() => {
                            handleAutoAppendRow(index);
                          }, 0);
                        }}
                      />
                    )}
                  />
                  <ButtonGroup>
                    <IconButton
                      tabIndex={-1}
                      onClick={() => {
                        addMetadataRow(index);
                      }}
                    >
                      <AddIcon />
                    </IconButton>
                    <IconButton
                      tabIndex={-1}
                      onClick={() => {
                        removeMetadataRow(index);
                      }}
                      style={{
                        visibility: fields.length > 1 ? "visible" : "hidden",
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

      {duplicateKey && (
        <Stack paddingTop={2}>
          <Typography color="error">
            {t("duplicateKey")} {duplicateKey[0]}
          </Typography>
        </Stack>
      )}

      {!isEditing && (
        <Stack paddingTop={2}>
          <FormLabel>{t("record")}</FormLabel>
          <Controller
            name="fileName"
            control={control}
            render={({ field, fieldState }) => (
              <Select
                {...field}
                size="small"
                variant="filled"
                disabled={recordItems.length <= 1}
                error={!!fieldState.error}
              >
                {recordItems.map((bag) => (
                  <MenuItem key={bag.name} value={bag.name}>
                    {bag.recordDisplayName}
                  </MenuItem>
                ))}
              </Select>
            )}
          />
        </Stack>
      )}

      {customFieldSchema?.properties && (!isEditing || watchedValues.customFieldValues) && (
        <Stack paddingTop={2} gap={2}>
          <CustomFieldValuesForm
            form={form as unknown as FormWithCustomFieldValues}
            properties={customFieldSchema.properties}
          />
        </Stack>
      )}
    </Stack>
  );
}
