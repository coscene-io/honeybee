// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import { TextField, IconButton, Box, FormControl } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useDebounce } from "use-debounce";

import { BinaryOperator, CosQuery } from "@foxglove/studio-base/util/coscene";
import { QueryFields } from "@foxglove/studio-base/util/queries";

const useStyles = makeStyles()((theme) => ({
  container: {
    padding: theme.spacing(0.5, 0),
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  searchIcon: {
    marginRight: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  clearButton: {
    marginRight: theme.spacing(-0.5),
  },
  formControl: {
    minWidth: "30%",
  },
}));

export default function DeviceTableFilter({
  filter,
  setFilter,
}: {
  filter: string | undefined;
  setFilter: (filter: string) => void;
}): React.ReactElement {
  const { classes } = useStyles();
  const { t } = useTranslation("task");

  // 内部维护的搜索查询状态
  const [searchQuery, setSearchQuery] = useState<string>("");

  // 防抖搜索查询
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);

  // 初始化时解析外部传入的filter（仅初始化时执行一次）
  useEffect(() => {
    if (!filter) {
      return;
    }

    try {
      const query = CosQuery.Companion.deserialize(filter);
      // 提取搜索查询
      const searchValue = query.getField(QueryFields.Q, BinaryOperator.HAS);
      setSearchQuery(typeof searchValue === "string" ? searchValue : "");
    } catch (error) {
      console.error("Failed to parse initial filter:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 生成过滤器字符串的函数
  const generateFilter = useCallback((searchQuery: string, currentFilter?: string): string => {
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

    return query.serialize();
  }, []);

  // 当内部状态变化时，通知外部组件
  useEffect(() => {
    const newFilter = generateFilter(debouncedSearchQuery, filter);
    setFilter(newFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, generateFilter, setFilter]);

  // 处理搜索输入变化
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchQuery(value);
  }, []);

  // 清除搜索
  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return (
    <Box className={classes.container}>
      <FormControl className={classes.formControl}>
        <TextField
          size="small"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t("searchDeviceName")}
          slotProps={{
            input: {
              startAdornment: <SearchIcon fontSize="small" className={classes.searchIcon} />,
              endAdornment: searchQuery && (
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
  );
}
