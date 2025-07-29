// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ListRecordsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import type {
  Property,
  CustomFieldValue,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import PlayCircleFilledWhiteOutlinedIcon from "@mui/icons-material/PlayCircleFilledWhiteOutlined";
import {
  Avatar,
  Chip,
  Stack,
  Typography,
  Box,
  Button,
  Link,
  IconButton,
  Tooltip,
} from "@mui/material";
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
import { useMemo, useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import { ConvertCustomFieldValue } from "@foxglove/studio-base/components/CustomFieldProperty/utils/convertCustomFieldValue";
import { useVizTargetSource } from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/useSelectSource";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

// 扩展Footer组件的props接口
declare module "@mui/x-data-grid" {
  interface FooterPropsOverrides {
    onButtonClick?: (selectedRows: string[]) => void;
    disableBatchAction?: boolean;
    batchActionButtonText?: string;
  }
}

const selectRecordCustomFieldSchema = (store: CoSceneBaseStore) => store.recordCustomFieldSchema;

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

// 创建者单元格组件
function CreatorCell({ params }: { params: GridRenderCellParams }) {
  const consoleApi = useConsoleApi();
  const [creator, getCreator] = useAsyncFn(async () => {
    if (params.value == undefined) {
      return undefined;
    }

    const users = await consoleApi.batchGetUsers([params.value as string]);
    return users.users[0];
  }, [consoleApi, params.value]);

  useEffect(() => {
    if (params.value != undefined) {
      getCreator().catch(() => {
        // 忽略错误，避免日志污染
      });
    }
  }, [params.value, getCreator]);

  if (creator.value == undefined) {
    return <Typography variant="body2">-</Typography>;
  }

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Avatar
        src={creator.value.avatar ?? undefined}
        variant="circular"
        style={{ width: 24, height: 24 }}
      />
      <Typography variant="body2">{creator.value.nickname}</Typography>
    </Stack>
  );
}

// 标签单元格组件
function LabelsCell({ params }: { params: GridRenderCellParams }) {
  const labels = params.value as Array<{ name: string; displayName: string }> | undefined;

  if (labels == undefined || labels.length === 0) {
    return <Typography variant="body2">-</Typography>;
  }

  return (
    <Stack direction="row" spacing={0.5} flexWrap="nowrap" gap={0.5}>
      {labels.map((label, index) => (
        <Chip
          key={`${label.name}-${index}`}
          label={label.displayName}
          size="small"
          variant="outlined"
        />
      ))}
    </Stack>
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

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

export default function RecordTable({
  listRecordsResponse,
  pageSize,
  currentPage,
  disableBatchAction,
  batchActionButtonText,
  disableSwitchSource = false,
  setPageSize,
  setCurrentPage,
  onSelectionChange,
  onBatchAction,
}: {
  listRecordsResponse: ListRecordsResponse;
  pageSize: number;
  currentPage: number;
  disableBatchAction?: boolean;
  batchActionButtonText?: string;
  disableSwitchSource?: boolean;
  setPageSize: (pageSize: number) => void;
  setCurrentPage: (currentPage: number) => void;
  onSelectionChange?: (selectedRowIds: string[]) => void;
  onBatchAction?: (selectedRowIds: string[]) => void;
}): React.ReactElement {
  const { classes } = useStyles();
  const { i18n, t } = useTranslation("task");
  const recordCustomFieldSchema = useBaseInfo(selectRecordCustomFieldSchema);
  const confirm = useConfirm();
  const selectVizTargetSource = useVizTargetSource();

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

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

  const handleVizTargetRecord = useCallback(
    ({ recordName, recordTitle }: { recordName: string; recordTitle: string }) => {
      void confirm({
        title: t("confirmVizTargetRecord"),
        prompt: t("confirmVizTargetRecordDescription", { recordTitle }),
        ok: t("enterImmediately"),
        cancel: t("cancel", {
          ns: "cosGeneral",
        }),
        variant: "danger",
      }).then((response) => {
        if (response === "ok") {
          void selectVizTargetSource({
            baseInfo: {
              ...baseInfo,
              recordDisplayName: recordTitle,
              recordId: recordName.split("/").pop() ?? "",
              files: [{ recordName }],
            },
            sourceId: "coscene-data-platform",
          });
        }
      });
    },
    [confirm, t, selectVizTargetSource, baseInfo],
  );

  // 定义基础列结构
  const baseColumns: GridColDef[] = useMemo(
    () => [
      {
        field: "name",
        headerName: t("recordName"),
        width: 200,
        renderCell: (params) => (
          <div className={classes.deviceId}>
            <Link
              href="#"
              underline="none"
              variant="body2"
              onClick={() => {
                window.open(
                  `https://${APP_CONFIG.DOMAIN_CONFIG.default?.webDomain}/${
                    baseInfo.organizationSlug
                  }/${baseInfo.projectSlug}/records/${params.row.name.split("/").pop()}`,
                  "_blank",
                );
              }}
            >
              {params.row.title ?? "-"}
            </Link>
            {!disableSwitchSource && (
              <div className={classes.vizButton}>
                <Tooltip title={t("playRecord")} placement="top">
                  <IconButton
                    size="small"
                    className={classes.playButton}
                    onClick={(e) => {
                      e.stopPropagation();

                      const recordName = String(params.row.name ?? params.id);
                      handleVizTargetRecord({ recordName, recordTitle: params.row.title ?? "" });
                    }}
                  >
                    <PlayCircleFilledWhiteOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </div>
            )}
            <Tooltip title={t("copyRecordId")} placement="top">
              <IconButton
                size="small"
                className={classes.playButton}
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(String(params.row.name));
                  toast.success(t("copySuccess"));
                }}
              >
                <ContentCopyOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </div>
        ),
      },
      {
        field: "labels",
        headerName: t("labels"),
        width: 250,
        sortable: false,
        renderCell: (params) => <LabelsCell params={params} />,
      },
      {
        field: "deviceId",
        headerName: t("deviceId"),
        width: 150,
        valueGetter: (_, row) => row.device?.serialNumber,
        renderCell: (params) => <Typography variant="body2">{params.value ?? "-"}</Typography>,
      },
      {
        field: "deviceName",
        headerName: t("deviceName"),
        width: 200,
        valueGetter: (_, row) => row.device?.displayName,
        renderCell: (params) => <Typography variant="body2">{params.value ?? "-"}</Typography>,
      },
      {
        field: "creator",
        headerName: t("creator"),
        width: 150,
        renderCell: (params) => <CreatorCell params={params} />,
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
      classes.deviceId,
      classes.vizButton,
      classes.playButton,
      disableSwitchSource,
      baseInfo.organizationSlug,
      baseInfo.projectSlug,
      handleVizTargetRecord,
    ],
  );

  // 动态生成自定义字段列
  const customFieldColumns: GridColDef[] = useMemo(() => {
    if (!recordCustomFieldSchema?.properties) {
      return [];
    }

    return recordCustomFieldSchema.properties.map((property: Property) => ({
      field: `customField_${property.id}`,
      headerName: property.name,
      width: 150,
      sortable: false,
      renderCell: (params) => <CustomFieldCell params={params} property={property} />,
    }));
  }, [recordCustomFieldSchema?.properties]);

  // 合并所有列
  const columns = useMemo<GridColDef[]>(
    () => [...baseColumns, ...customFieldColumns],
    [baseColumns, customFieldColumns],
  );

  // 准备行数据
  const rows = useMemo(() => {
    return listRecordsResponse.records.map((record) => ({
      id: record.name,
      name: record.name,
      title: record.title,
      labels: record.labels,
      device: record.device,
      creator: record.creator,
      createTime: record.createTime,
      updateTime: record.updateTime,
      customFieldValues: record.customFieldValues,
    }));
  }, [listRecordsResponse.records]);

  return (
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
        footer: { onButtonClick: onBatchAction, disableBatchAction, batchActionButtonText },
      }}
    />
  );
}
