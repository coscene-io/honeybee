// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Device } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/device_pb";
import { ListProjectDevicesResponse } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/services/device_pb";
import type {
  Property,
  CustomFieldValue,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import PlayCircleFilledWhiteOutlinedIcon from "@mui/icons-material/PlayCircleFilledWhiteOutlined";
import { Typography, Box, Button, Link, IconButton, Tooltip, alpha } from "@mui/material";
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
import { useVizTargetSource } from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/useSelectSource";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";

// 扩展Footer组件的props接口
declare module "@mui/x-data-grid" {
  interface FooterPropsOverrides {
    onButtonClick?: (selectedRows: string[]) => void;
    disableBatchAction?: boolean;
    batchActionButtonText?: string;
  }
}

const selectDeviceCustomFieldSchema = (store: CoreDataStore) => store.deviceCustomFieldSchema;

const useStyles = makeStyles()((theme) => ({
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
    "& .MuiDataGrid-selectedRowCount": {
      display: "none",
    },
  },
  selectionInfo: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  playButton: {
    marginLeft: theme.spacing(1),
    opacity: 0,
    transition: "opacity 0.2s",
    ".MuiDataGrid-row:hover &": {
      opacity: 1,
    },
    backgroundColor: theme.palette.background.paper,
    "&:hover": {
      backgroundColor: alpha(theme.palette.grey[400], 0.8),
    },
  },
  deviceId: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
  },
  vizButton: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    margin: "auto",
  },
}));

// 自定义Footer组件
function CustomFooter({
  onButtonClick,
  disableBatchAction = false,
  batchActionButtonText,
}: {
  onButtonClick?: (selectedRows: string[]) => void;
  disableBatchAction?: boolean;
  batchActionButtonText?: string;
}) {
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

        {selectedCount > 0 && !disableBatchAction && (
          <Button variant="outlined" size="small" onClick={handleButtonClick}>
            {batchActionButtonText ?? t("batchOperation")}
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

const selectExternalInitConfig = (store: CoreDataStore) => store.externalInitConfig;
const selectOrganization = (store: CoreDataStore) => store.organization;
const selectProject = (store: CoreDataStore) => store.project;

export default function DevicesTable({
  linkedDevicesResponse,
  pageSize,
  currentPage,
  disableBatchAction,
  batchActionButtonText,
  disableSwitchSource = false,
  setPageSize,
  setCurrentPage,
  onSelectionChange,
  onBatchAction,
  loading = false,
}: {
  linkedDevicesResponse: ListProjectDevicesResponse;
  pageSize: number;
  currentPage: number;
  disableBatchAction?: boolean;
  batchActionButtonText?: string;
  disableSwitchSource?: boolean;
  setPageSize: (pageSize: number) => void;
  setCurrentPage: (currentPage: number) => void;
  onSelectionChange?: (selectedRowIds: string[]) => void;
  onBatchAction?: (selectedRowIds: string[]) => void;
  loading?: boolean;
}): React.ReactElement {
  const { classes } = useStyles();
  const { i18n, t } = useTranslation("task");
  const deviceCustomFieldSchema = useCoreData(selectDeviceCustomFieldSchema);
  const domainConfig = getDomainConfig();

  const organization = useCoreData(selectOrganization);
  const project = useCoreData(selectProject);

  const organizationSlug = useMemo(() => organization.value?.slug ?? "", [organization.value]);
  const projectSlug = useMemo(() => project.value?.slug ?? "", [project.value]);

  const confirm = useConfirm();
  const selectVizTargetSource = useVizTargetSource();

  const externalInitConfig = useCoreData(selectExternalInitConfig);

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

  const handleVizTargetDevice = useCallback(
    ({ device }: { device: Device }) => {
      void confirm({
        title: t("confirmVizTargetDevice"),
        prompt: t("confirmVizTargetDeviceDescription", { deviceTitle: device.displayName }),
        ok: t("switchImmediately"),
        cancel: t("cancel", {
          ns: "general",
        }),
        variant: "danger",
      }).then((response) => {
        if (response === "ok") {
          void selectVizTargetSource({
            externalInitConfig: {
              ...externalInitConfig,
              recordId: undefined,
              files: undefined,
              jobRunsId: undefined,
            },
            sourceId: "coscene-websocket",
            device,
          });
        }
      });
    },
    [confirm, t, selectVizTargetSource, externalInitConfig],
  );

  // 定义基础列结构
  const baseColumns: GridColDef[] = useMemo(
    () => [
      {
        field: "serialNumber",
        headerName: t("deviceId"),
        width: 200,
        renderCell: (params) => (
          <div className={classes.deviceId}>
            <Link
              href="#"
              underline="none"
              variant="body2"
              onClick={() => {
                window.open(
                  `https://${
                    domainConfig.webDomain
                  }/${organizationSlug}/${projectSlug}/devices/project-devices/${params.row.name
                    .split("/")
                    .pop()}`,

                  "_blank",
                );
              }}
            >
              {params.value ?? "-"}
            </Link>
            {!disableSwitchSource && (
              <div className={classes.vizButton}>
                <Tooltip title={t("visualizeDevice")} placement="top">
                  <IconButton
                    size="small"
                    className={classes.playButton}
                    onClick={(e) => {
                      e.stopPropagation();

                      handleVizTargetDevice({
                        device: params.row,
                      });
                    }}
                  >
                    <PlayCircleFilledWhiteOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </div>
            )}
          </div>
        ),
      },
      {
        field: "displayName",
        headerName: t("deviceName"),
        width: 250,
        renderCell: (params) => <Typography variant="body2">{params.value ?? "-"}</Typography>,
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
    [
      t,
      domainConfig.webDomain,
      classes.deviceId,
      classes.vizButton,
      classes.playButton,
      disableSwitchSource,
      organizationSlug,
      projectSlug,
      handleVizTargetDevice,
    ],
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
    return linkedDevicesResponse.projectDevices.map((device) => ({
      id: device.name,
      name: device.name,
      serialNumber: device.serialNumber,
      displayName: device.displayName,
      clientStatus: "online", // 默认在线状态
      createTime: device.createTime,
      updateTime: device.updateTime,
      customFieldValues: device.customFieldValues,
    }));
  }, [linkedDevicesResponse.projectDevices]);

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      paginationModel={paginationModel}
      onPaginationModelChange={handlePaginationModelChange}
      rowSelectionModel={rowSelectionModel}
      onRowSelectionModelChange={handleSelectionModelChange}
      pageSizeOptions={[10, 25, 50, 100]}
      paginationMode="server"
      rowCount={Number(linkedDevicesResponse.totalSize)}
      loading={loading}
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
        footer: { onButtonClick: onBatchAction, disableBatchAction, batchActionButtonText },
      }}
    />
  );
}
