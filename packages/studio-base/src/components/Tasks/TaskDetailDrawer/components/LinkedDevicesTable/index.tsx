// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ListProjectDevicesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/device_pb";
import type {
  Property,
  CustomFieldValue,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { Chip, Typography, Box, Button } from "@mui/material";
import {
  DataGrid,
  GridColDef,
  GridRenderCellParams,
  GridPaginationModel,
  GridRowSelectionModel,
  useGridApiContext,
  useGridSelector,
  gridRowSelectionStateSelector,
  GridFooter,
  GridFooterContainer,
} from "@mui/x-data-grid";
import { zhCN, jaJP } from "@mui/x-data-grid/locales";
import dayjs from "dayjs";
import { useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { ConvertCustomFieldValue } from "@foxglove/studio-base/components/CustomFieldProperty/utils/convertCustomFieldValue";
import DeviceTableFilter from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedDevicesTable/components/DeviceTableFilter";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";

// 扩展Footer组件的props接口
declare module "@mui/x-data-grid" {
  interface FooterPropsOverrides {
    onButtonClick?: (selectedRows: string[]) => void;
  }
}

const selectDeviceCustomFieldSchema = (store: CoSceneBaseStore) => store.deviceCustomFieldSchema;

const useStyles = makeStyles()((theme) => ({
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  dataGrid: {
    flex: 1,
    "& .MuiDataGrid-cell": {
      display: "flex",
      alignItems: "center",
    },
    "& .MuiDataGrid-row": {
      "&:hover": {
        backgroundColor: theme.palette.action.hover,
      },
    },
    // padding: "0px 24px 12px !important",
  },
  customFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing(0.5, 1),
    "& .MuiDataGrid-footerContainer": {
      padding: 0,
      minHeight: "auto",
    },
  },
  selectionInfo: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  statusChip: {
    minWidth: 60,
  },
}));

// 自定义Footer组件
function CustomFooter({ onButtonClick }: { onButtonClick?: (selectedRows: string[]) => void }) {
  const { classes } = useStyles();
  const { t } = useTranslation("task");
  const apiRef = useGridApiContext();
  const rowSelectionState = useGridSelector(apiRef, gridRowSelectionStateSelector);

  const selectedRowIds = Array.isArray(rowSelectionState)
    ? rowSelectionState
    : Array.from(rowSelectionState);

  const selectedCount = selectedRowIds.length;

  const handleButtonClick = () => {
    if (onButtonClick) {
      onButtonClick(selectedRowIds.map((id) => String(id)));
    }
  };

  return (
    <GridFooterContainer className={classes.customFooter}>
      <Box className={classes.selectionInfo}>
        {selectedCount > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("selectedRowsCount", { count: selectedCount })}
          </Typography>
        )}

        {selectedCount > 0 && (
          <Button variant="outlined" size="small" onClick={handleButtonClick}>
            {t("batchOperation")}
          </Button>
        )}
      </Box>
      {/* 渲染默认的Footer内容，包括分页器 */}
      <GridFooter />
    </GridFooterContainer>
  );
}

// 时间单元格组件
function TimeCell({ params }: { params: GridRenderCellParams }) {
  if (params.value == undefined) {
    return <Typography variant="body2">-</Typography>;
  }

  const time = params.value as { toDate: () => Date };
  return (
    <Typography variant="body2">{dayjs(time.toDate()).format("YYYY-MM-DD HH:mm:ss")}</Typography>
  );
}

// 设备状态单元格组件
function DeviceStatusCell({ params: _params }: { params: GridRenderCellParams }) {
  const { classes } = useStyles();

  // 目前全部默认在线
  return (
    <Chip
      label="在线"
      size="small"
      color="success"
      variant="filled"
      className={classes.statusChip}
    />
  );
}

// 自定义字段单元格组件
function CustomFieldCell({
  params,
  property,
}: {
  params: GridRenderCellParams;
  property: Property;
}) {
  const customFieldValues = params.row.customFieldValues as CustomFieldValue[] | undefined;

  if (!customFieldValues || !Array.isArray(customFieldValues)) {
    return <Typography variant="body2">-</Typography>;
  }

  // 查找对应属性的自定义字段值
  const customFieldValue = customFieldValues.find(
    (value: CustomFieldValue) => value.property?.id === property.id,
  );

  if (!customFieldValue) {
    return <Typography variant="body2">-</Typography>;
  }

  const displayValue = ConvertCustomFieldValue({ customFieldValue, noWrap: true });

  return <Typography variant="body2">{displayValue ?? "-"}</Typography>;
}

export default function LinkedDevicesTable({
  linkedDevices,
  pageSize,
  currentPage,
  setPageSize,
  setCurrentPage,
  onSelectionChange,
  onBatchAction,
  filter,
  setFilter,
}: {
  linkedDevices: ListProjectDevicesResponse;
  pageSize: number;
  currentPage: number;
  setPageSize: (pageSize: number) => void;
  setCurrentPage: (currentPage: number) => void;
  onSelectionChange?: (selectedRowIds: string[]) => void;
  onBatchAction?: (selectedRowIds: string[]) => void;
  filter: string | undefined;
  setFilter: (filter: string) => void;
}): React.ReactElement {
  const { classes } = useStyles();
  const { i18n, t } = useTranslation("task");
  const deviceCustomFieldSchema = useBaseInfo(selectDeviceCustomFieldSchema);

  // 选择状态管理
  const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>([]);

  // 根据当前语言获取DataGrid的locale文本
  const dataGridLocaleText = useMemo(() => {
    switch (i18n.language) {
      case "zh":
        return zhCN.components.MuiDataGrid.defaultProps.localeText;
      case "ja":
        return jaJP.components.MuiDataGrid.defaultProps.localeText;
      default:
        return undefined; // 使用默认英文
    }
  }, [i18n.language]);

  // 将分页模型转换为DataGrid格式
  const paginationModel = useMemo<GridPaginationModel>(
    () => ({
      page: currentPage,
      pageSize,
    }),
    [currentPage, pageSize],
  );

  const handlePaginationModelChange = useCallback(
    (model: GridPaginationModel) => {
      setCurrentPage(model.page);
      setPageSize(model.pageSize);
    },
    [setCurrentPage, setPageSize],
  );

  // 处理选择变化
  const handleSelectionModelChange = useCallback(
    (newSelectionModel: GridRowSelectionModel) => {
      setRowSelectionModel(newSelectionModel);
      if (onSelectionChange) {
        // 将选择模型转换为字符串数组
        const selectedIds = Array.isArray(newSelectionModel)
          ? newSelectionModel.map((id) => String(id))
          : [];
        onSelectionChange(selectedIds);
      }
    },
    [onSelectionChange],
  );

  // 定义基础列结构
  const baseColumns: GridColDef[] = useMemo(
    () => [
      {
        field: "serialNumber",
        headerName: t("deviceId"),
        width: 200,
        renderCell: (params) => <Typography variant="body2">{params.value ?? "-"}</Typography>,
      },
      {
        field: "displayName",
        headerName: t("deviceName"),
        width: 250,
        renderCell: (params) => <Typography variant="body2">{params.value ?? "-"}</Typography>,
      },
      {
        field: "clientStatus",
        headerName: "客户端状态",
        width: 120,
        renderCell: (params) => <DeviceStatusCell params={params} />,
      },
      {
        field: "createTime",
        headerName: t("createTime"),
        width: 180,
        renderCell: (params) => <TimeCell params={params} />,
      },
      {
        field: "updateTime",
        headerName: t("updateTime"),
        width: 180,
        renderCell: (params) => <TimeCell params={params} />,
      },
    ],
    [t],
  );

  // 动态生成自定义字段列
  const customFieldColumns: GridColDef[] = useMemo(() => {
    if (!deviceCustomFieldSchema?.properties) {
      return [];
    }

    return deviceCustomFieldSchema.properties.map((property: Property) => ({
      field: `customField_${property.id}`,
      headerName: property.name,
      width: 150,
      sortable: false,
      renderCell: (params) => <CustomFieldCell params={params} property={property} />,
    }));
  }, [deviceCustomFieldSchema?.properties]);

  // 合并所有列
  const columns = useMemo<GridColDef[]>(
    () => [...baseColumns, ...customFieldColumns],
    [baseColumns, customFieldColumns],
  );

  // 准备行数据
  const rows = useMemo(() => {
    return linkedDevices.projectDevices.map((device) => ({
      id: device.name,
      name: device.name,
      serialNumber: device.serialNumber,
      displayName: device.displayName,
      clientStatus: "online", // 默认在线状态
      createTime: device.createTime,
      updateTime: device.updateTime,
      customFieldValues: device.customFieldValues,
    }));
  }, [linkedDevices.projectDevices]);

  return (
    <Box className={classes.container}>
      <DeviceTableFilter filter={filter} setFilter={setFilter} />
      <DataGrid
        rows={rows}
        columns={columns}
        paginationModel={paginationModel}
        onPaginationModelChange={handlePaginationModelChange}
        rowSelectionModel={rowSelectionModel}
        onRowSelectionModelChange={handleSelectionModelChange}
        pageSizeOptions={[10, 25, 50, 100]}
        loading={false}
        checkboxSelection
        disableColumnFilter
        disableRowSelectionOnClick
        disableVirtualization
        density="compact"
        className={classes.dataGrid}
        localeText={dataGridLocaleText}
        slots={{
          footer: CustomFooter,
        }}
        slotProps={{
          footer: { onButtonClick: onBatchAction },
        }}
      />
    </Box>
  );
}
