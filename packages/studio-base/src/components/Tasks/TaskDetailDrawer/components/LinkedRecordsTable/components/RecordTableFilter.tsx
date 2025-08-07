// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import {
  TextField,
  IconButton,
  Typography,
  Box,
  FormControl,
  Select,
  MenuItem,
  Chip,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";
import { useDebounce } from "use-debounce";

import RecordLabelSelector from "@foxglove/studio-base/components/RecordInfo/RecordLabelSelector";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { BinaryOperator, CosQuery } from "@foxglove/studio-base/util/coscene";
import { QueryFields } from "@foxglove/studio-base/util/queries";

const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;

interface FilterState {
  searchQuery: string;
  selectedLabels: string[];
  selectedDevices: string[];
}

const useStyles = makeStyles()((theme) => ({
  container: {
    padding: theme.spacing(2),
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  filterBox: {
    flex: "1 1 200px",
    minWidth: "200px",
  },
  searchIcon: {
    marginRight: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  clearButton: {
    marginRight: theme.spacing(-0.5),
  },
  clearAllContainer: {
    marginTop: theme.spacing(2),
    display: "flex",
    justifyContent: "flex-end",
  },
  clearAllButton: {
    color: theme.palette.text.secondary,
  },
  clearAllText: {
    marginLeft: theme.spacing(0.5),
  },
}));

export default function RecordTableFilter({
  filter,
  setFilter,
}: {
  filter: string | undefined;
  setFilter: (filter: string) => void;
}): React.ReactElement {
  const { classes } = useStyles();
  const { t } = useTranslation("task");
  const { t: tGeneral } = useTranslation("cosGeneral");
  const consoleApi = useConsoleApi();
  const externalInitConfig = useCoreData(selectExternalInitConfig);

  // 内部维护的过滤状态
  const [filterState, setFilterState] = useState<FilterState>({
    searchQuery: "",
    selectedLabels: [],
    selectedDevices: [],
  });

  // 防抖搜索查询
  const [debouncedSearchQuery] = useDebounce(filterState.searchQuery, 300);

  // 获取标签列表
  const [labels, getLabels] = useAsyncFn(async () => {
    if (!externalInitConfig?.warehouseId || !externalInitConfig.projectId) {
      return [];
    }

    const response = await consoleApi.listLabels({
      pageSize: 1000,
      warehouseId: externalInitConfig.warehouseId,
      projectId: externalInitConfig.projectId,
    });

    return response.labels.map(
      (label) =>
        new Label({
          ...label,
          name: label.name.split("/").pop() ?? "",
        }),
    );
  }, [externalInitConfig?.warehouseId, externalInitConfig?.projectId, consoleApi]);

  // 获取设备列表
  const [devices, getDevices] = useAsyncFn(async () => {
    if (!externalInitConfig?.warehouseId || !externalInitConfig.projectId) {
      return [];
    }

    const emptyFilter = CosQuery.Companion.empty();
    const response = await consoleApi.listProjectDevices({
      filter: emptyFilter,
      pageSize: 1000,
      currentPage: 0,
      warehouseId: externalInitConfig.warehouseId,
      projectId: externalInitConfig.projectId,
    });

    return response.projectDevices;
  }, [consoleApi, externalInitConfig?.warehouseId, externalInitConfig?.projectId]);

  // 加载数据
  useEffect(() => {
    void getLabels();
    void getDevices();
  }, [getLabels, getDevices]);

  // 初始化时解析外部传入的filter（仅初始化时执行一次）
  useEffect(() => {
    if (!filter) {
      return;
    }

    try {
      const query = CosQuery.Companion.deserialize(filter);

      // 提取搜索查询
      const searchValue = query.getField(QueryFields.Q, BinaryOperator.HAS);

      // 提取标签
      const labelValues = query.getListField(QueryFields.LABELS, BinaryOperator.EQ) ?? [];

      // 提取设备
      const deviceValues = query.getListField(QueryFields.DEVICE_ID, BinaryOperator.EQ) ?? [];

      setFilterState({
        searchQuery: typeof searchValue === "string" ? searchValue : "",
        selectedLabels: labelValues,
        selectedDevices: deviceValues,
      });
    } catch (error) {
      console.error("Failed to parse initial filter:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 生成过滤器字符串的函数
  const generateFilter = useCallback(
    (
      searchQuery: string,
      selectedLabels: string[],
      selectedDevices: string[],
      currentFilter?: string,
    ): string => {
      // 如果有当前过滤器，则基于它来修改，否则创建空查询
      let query: CosQuery;
      if (currentFilter) {
        try {
          query = CosQuery.Companion.deserialize(currentFilter);
        } catch {
          query = CosQuery.Companion.empty();
        }
      } else {
        query = CosQuery.Companion.empty();
      }

      // 设置搜索查询（包括清空的情况）
      if (searchQuery.trim()) {
        query.setField(QueryFields.Q, [BinaryOperator.HAS], [searchQuery.trim()]);
      } else {
        query.setField(QueryFields.Q, [BinaryOperator.HAS], []);
      }

      // 设置标签过滤（包括清空的情况）
      if (selectedLabels.length > 0) {
        query.setListField(QueryFields.LABELS, BinaryOperator.EQ, selectedLabels);
      } else {
        query.setListField(QueryFields.LABELS, BinaryOperator.EQ, []);
      }

      // 设置设备过滤（包括清空的情况）
      if (selectedDevices.length > 0) {
        query.setListField(QueryFields.DEVICE_ID, BinaryOperator.EQ, selectedDevices);
      } else {
        query.setListField(QueryFields.DEVICE_ID, BinaryOperator.EQ, []);
      }

      return query.serialize();
    },
    [],
  );

  // 当内部状态变化时，通知外部组件
  useEffect(() => {
    const newFilter = generateFilter(
      debouncedSearchQuery,
      filterState.selectedLabels,
      filterState.selectedDevices,
      filter,
    );
    setFilter(newFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearchQuery,
    filterState.selectedLabels,
    filterState.selectedDevices,
    generateFilter,
    setFilter,
  ]);

  // 处理搜索输入变化
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFilterState((prev) => ({ ...prev, searchQuery: value }));
  }, []);

  // 清除搜索
  const handleClearSearch = useCallback(() => {
    setFilterState((prev) => ({ ...prev, searchQuery: "" }));
  }, []);

  // 处理标签变化
  const handleLabelsChange = useCallback((_event: React.SyntheticEvent, newValue: Label[]) => {
    const labelNames = newValue.map((label) => label.name);
    setFilterState((prev) => ({
      ...prev,
      selectedLabels: labelNames,
    }));
  }, []);

  // 清除所有过滤器
  const handleClearAll = useCallback(() => {
    setFilterState({
      searchQuery: "",
      selectedLabels: [],
      selectedDevices: [],
    });
  }, []);

  // 检查是否有活动过滤器
  const hasActiveFilters = useMemo(() => {
    return (
      filterState.searchQuery.trim() !== "" ||
      filterState.selectedLabels.length > 0 ||
      filterState.selectedDevices.length > 0
    );
  }, [filterState]);

  return (
    <Box className={classes.container}>
      <Stack direction="row" gap={2} flexWrap="wrap">
        {/* 搜索输入框 */}
        <Box className={classes.filterBox}>
          <FormControl fullWidth>
            <TextField
              size="small"
              value={filterState.searchQuery}
              onChange={handleSearchChange}
              placeholder={tGeneral("search")}
              slotProps={{
                input: {
                  startAdornment: <SearchIcon fontSize="small" className={classes.searchIcon} />,
                  endAdornment: filterState.searchQuery && (
                    <IconButton
                      edge="end"
                      onClick={handleClearSearch}
                      size="small"
                      className={classes.clearButton}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  ),
                },
              }}
            />
          </FormControl>
        </Box>

        {/* 标签选择器 */}
        <Box className={classes.filterBox}>
          <FormControl fullWidth>
            <RecordLabelSelector
              value={filterState.selectedLabels}
              options={labels.value ?? []}
              onChange={handleLabelsChange}
              placeholder={t("labels")}
            />
          </FormControl>
        </Box>

        {/* 设备选择器 */}
        <Box className={classes.filterBox}>
          <FormControl fullWidth>
            <Select
              multiple
              size="small"
              value={filterState.selectedDevices}
              onChange={(event) => {
                const value = event.target.value;
                const deviceIds = typeof value === "string" ? value.split(",") : value;
                setFilterState((prev) => ({ ...prev, selectedDevices: deviceIds }));
              }}
              variant="filled"
              displayEmpty
              renderValue={(selected) => {
                if (selected.length === 0) {
                  return (
                    <Typography variant="body2" color="text.secondary">
                      {t("deviceId")}
                    </Typography>
                  );
                }

                return selected.map((deviceId, index) => {
                  const device = (devices.value ?? []).find(
                    (d) => d.name.split("/").pop() === deviceId,
                  );
                  return (
                    <Chip
                      label={device?.displayName ?? device?.serialNumber ?? deviceId}
                      size="small"
                      key={`${deviceId}-${index}`}
                      style={{
                        marginRight: "4px",
                        height: "16px",
                        fontSize: "12px",
                        transform: "scale(0.9)",
                        transformOrigin: "left center",
                      }}
                    />
                  );
                });
              }}
              MenuProps={{
                slotProps: {
                  list: {
                    dense: true,
                  },
                  paper: {
                    style: {
                      maxHeight: 240,
                      overflow: "auto",
                    },
                  },
                },
              }}
            >
              {(devices.value ?? []).map((device) => {
                const deviceId = device.name.split("/").pop() ?? "";
                return (
                  <MenuItem key={device.name} value={deviceId}>
                    <Stack>
                      <Typography variant="body2">
                        {device.displayName || device.serialNumber}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {device.serialNumber}
                      </Typography>
                    </Stack>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        </Box>
      </Stack>

      {/* 清除所有过滤器按钮 */}
      {hasActiveFilters && (
        <Box className={classes.clearAllContainer}>
          <IconButton size="small" onClick={handleClearAll} className={classes.clearAllButton}>
            <ClearIcon fontSize="small" />
            <Typography variant="caption" className={classes.clearAllText}>
              {t("clearAllFilters")}
            </Typography>
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
