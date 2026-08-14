// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  BusinessCenterOutlined as BusinessCenterOutlinedIcon,
  FolderOutlined as FolderOutlinedIcon,
  PersonOutlined as PersonOutlinedIcon,
  Search as SearchIcon,
  SpaceDashboardOutlined as SpaceDashboardOutlinedIcon,
  PlayArrow as PlayArrowIcon,
  Equalizer as EqualizerIcon,
  MoreVert as MoreVertIcon,
  Close as CloseIcon,
  AutoAwesomeOutlined as AutoAwesomeOutlinedIcon,
  ContentCopyOutlined as ContentCopyOutlinedIcon,
} from "@mui/icons-material";
import {
  Box,
  Breadcrumbs,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { DataGrid, GridColDef, GridActionsCellItem, GridSortModel } from "@mui/x-data-grid";
import { zhCN, jaJP } from "@mui/x-data-grid/locales";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useState, useMemo, useCallback, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CopyLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/CopyLayoutDialog";
import { LayoutTableRowMenu } from "@foxglove/studio-base/components/CoSceneLayout/LayoutTableRowMenu";
import { MoveToFolderDialog } from "@foxglove/studio-base/components/CoSceneLayout/MoveToFolderDialog";
import { RenameLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/RenameLayoutDialog";
import { CreateLayoutItems } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateLayoutItems";
import { UserStore, useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { Layout, layoutIsProject } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import type { RecommendedLayoutDescriptor } from "@foxglove/studio-base/services/RecommendedLayouts";

const selectLoginStatus = (store: UserStore) => store.loginStatus;
const selectNoProject = (state: CoreDataStore) => !state.externalInitConfig?.projectId;

dayjs.extend(relativeTime);

interface LayoutWithFolder {
  id: string;
  name: string;
  folder: string;
  isFolder: boolean;
  category: "personal" | "project" | "recommended";
  layout?: Layout;
  recommendedLayout?: RecommendedLayoutDescriptor;
  updateTime?: number;
}

const useStyles = makeStyles()((theme) => ({
  root: {
    height: "100%",
    width: "100%",
  },
  layoutContainer: {
    display: "flex",
    height: "100%",
  },
  sidebar: {
    padding: theme.spacing(2),
    width: "20%",
    minWidth: 200,
    borderRight: `1px solid ${theme.palette.divider}`,
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  contentArea: {
    width: "80%",
    padding: theme.spacing(2),
    flex: 1,
  },
  listItemIcon: {
    minWidth: 26,
    "& svg": {
      fontSize: "1rem",
    },
  },
  layoutNameBox: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    textDecoration: "none",
    "& svg": {
      color: theme.palette.text.secondary,
    },
  },
  folderItem: {
    paddingLeft: theme.spacing(4),
  },
  breadcrumbContainer: {
    display: "flex",
  },
  breadcrumbs: {
    flex: 1,
    marginBottom: theme.spacing(1),
  },
  closeButton: {
    marginTop: theme.spacing(-1),
    marginRight: theme.spacing(-1),
    height: 0,
  },
  toolbar: {
    display: "flex",
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  searchField: {
    flexGrow: 1,
    maxWidth: 300,
  },
  dataGrid: {
    border: "none",
    "& .MuiDataGrid-columnHeaders": {
      backgroundColor: "transparent",
    },
    "& .MuiDataGrid-cell": {
      borderColor: theme.palette.divider,
      display: "flex",
      alignItems: "center",
    },
    "& .MuiDataGrid-row:hover": {
      backgroundColor: theme.palette.action.hover,
      "& .play-button": {
        opacity: 1,
      },
    },
    "& .selected-row": {
      backgroundColor: theme.palette.action.selected,
    },
    "& .play-button": {
      opacity: 0,
      transition: "opacity 0.2s ease-in-out",
    },
  },
  boxPadding: {
    paddingBottom: theme.spacing(2),
  },
  listPadding: {
    paddingTop: 0,
  },
  overflowContainter: {
    overflow: "auto",
    flex: 1,
    minHeight: 0,
  },
  gridContainer: {
    height: "calc(100vh - 150px)",
    width: "100%",
  },
  workingIndicator: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: theme.palette.primary.main,
    flexShrink: 0,
  },
}));

export function CoSceneLayoutContent({
  currentLayoutId,
  layouts,
  supportsProjectWrite,
  onSelectLayout,
  onDeleteLayout,
  onRenameLayout,
  onExportLayout,
  onOverwriteLayout,
  onRevertLayout,
  onCreateLayout,
  onMoveLayout,
  recommendedLayouts,
  onSelectRecommendedLayout,
  onCopyRecommendedLayout,
  onClose,
}: {
  currentLayoutId?: LayoutID;
  supportsProjectWrite: boolean;
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    allLayouts: Layout[];
  };
  onSelectLayout: (layout: Layout) => void;
  onDeleteLayout: (layout: Layout) => void;
  onRenameLayout: (layout: Layout, newName: string) => void;
  onExportLayout: (layout: Layout) => void;
  onOverwriteLayout: (layout: Layout) => void;
  onRevertLayout: (layout: Layout) => void;
  onCreateLayout: (params: CreateLayoutParams) => void;
  onMoveLayout: (layout: Layout, newFolder: string) => void;
  recommendedLayouts: readonly RecommendedLayoutDescriptor[];
  onSelectRecommendedLayout: (layout: RecommendedLayoutDescriptor) => void;
  onCopyRecommendedLayout: (layout: RecommendedLayoutDescriptor) => void;
  onClose: () => void;
}): React.JSX.Element {
  const loginStatus = useCurrentUser(selectLoginStatus);
  const noProject = useCoreData(selectNoProject);

  const { t, i18n } = useTranslation(["layout", "openDialog"]);
  const { classes } = useStyles();
  const [selectedFolder, setSelectedFolder] = useState<{
    category: "all" | "personal" | "project" | "recommended";
    folder: string;
  }>({ category: "all", folder: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const ambiguousRecommendedNames = useMemo(() => {
    const transportsByName = new Map<string, Set<RecommendedLayoutDescriptor["transport"]>>();
    for (const layout of recommendedLayouts) {
      const transports = transportsByName.get(layout.name) ?? new Set();
      transports.add(layout.transport);
      transportsByName.set(layout.name, transports);
    }
    return new Set(
      [...transportsByName.entries()]
        .filter(([, transports]) => transports.size > 1)
        .map(([name]) => name),
    );
  }, [recommendedLayouts]);

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

  const [menu, setMenu] = useState<{
    anchorEl: HTMLElement | undefined;
    layout: Layout | undefined;
  }>({ anchorEl: undefined, layout: undefined });

  const [dialog, setDialog] = useState<{
    type: "rename" | "copy" | "move" | undefined;
    layout: Layout | undefined;
  }>({ type: undefined, layout: undefined });

  const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>, layout: Layout) => {
    setMenu({ anchorEl: event.currentTarget, layout });
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenu({ anchorEl: undefined, layout: undefined });
  }, []);

  const handleOpenDialog = useCallback((type: "rename" | "copy" | "move", layout: Layout) => {
    setDialog({ type, layout });
  }, []);

  const handleCloseDialog = useCallback(() => {
    setDialog({ type: undefined, layout: undefined });
  }, []);

  // Filter layouts based on selection
  const rows: LayoutWithFolder[] = useMemo(() => {
    const getRecommendedLayoutName = (layout: RecommendedLayoutDescriptor) =>
      selectedFolder.category === "all" && ambiguousRecommendedNames.has(layout.name)
        ? `${layout.name} / ${layout.transport === "h264" ? t("h264") : t("defaultLayoutFolder")}`
        : layout.name;
    let filtered: Layout[] = layouts?.allLayouts ?? [];
    let filteredRecommended = [...recommendedLayouts];
    if (selectedFolder.category === "personal") {
      filtered = filtered.filter((l) => l.permission === "PERSONAL_WRITE");
      filteredRecommended = [];
    } else if (selectedFolder.category === "project") {
      filtered = filtered.filter((l) => layoutIsProject(l));
      filteredRecommended = [];
    } else if (selectedFolder.category === "recommended") {
      filtered = [];
    }

    let folders: Array<{
      category: "personal" | "project" | "recommended";
      folder: string;
    }> = [];
    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((l) => l.name.toLowerCase().includes(query));
      filteredRecommended = filteredRecommended.filter((layout) =>
        getRecommendedLayoutName(layout).toLowerCase().includes(query),
      );
    } else {
      if (selectedFolder.category === "personal" || selectedFolder.category === "project") {
        filtered = filtered.filter((l) => l.folder === selectedFolder.folder);
      } else if (selectedFolder.category === "recommended") {
        filteredRecommended = selectedFolder.folder
          ? filteredRecommended.filter((layout) => layout.transport === selectedFolder.folder)
          : [];
      }

      if (!selectedFolder.folder) {
        if (selectedFolder.category === "personal") {
          folders = (layouts?.personalFolders ?? []).map((folder) => ({
            category: "personal",
            folder,
          }));
        } else if (selectedFolder.category === "project") {
          folders = (layouts?.projectFolders ?? []).map((folder) => ({
            category: "project",
            folder,
          }));
        } else if (selectedFolder.category === "recommended") {
          folders = (["default", "h264"] as const).map((folder) => ({
            category: "recommended",
            folder,
          }));
        }
      }
    }

    return [
      ...folders
        .map(({ category, folder }) => {
          return {
            id: `folder:${category}:${folder}`,
            name: folder,
            folder,
            isFolder: true,
            category,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      ...filtered
        .map((layout) => {
          const savedAt = layout.working?.savedAt ?? layout.baseline.savedAt;
          return {
            id: layout.id,
            layout,
            name: layout.name,
            folder: layout.folder,
            isFolder: false,
            category:
              layout.permission === "PERSONAL_WRITE" ? ("personal" as const) : ("project" as const),
            updateTime: savedAt ? new Date(savedAt).getTime() : 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      ...filteredRecommended
        .map((recommendedLayout) => ({
          id: recommendedLayout.id,
          recommendedLayout,
          name: getRecommendedLayoutName(recommendedLayout),
          folder: recommendedLayout.transport,
          isFolder: false,
          category: "recommended" as const,
          updateTime: recommendedLayout.generatedAt
            ? new Date(recommendedLayout.generatedAt).getTime()
            : 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }, [
    ambiguousRecommendedNames,
    layouts,
    recommendedLayouts,
    searchQuery,
    selectedFolder.category,
    selectedFolder.folder,
    t,
  ]);

  // Define DataGrid columns
  const columns: GridColDef<LayoutWithFolder>[] = useMemo(
    () => [
      {
        field: "icon",
        headerName: "",
        width: 50,
        align: "center",
        sortable: false,
        renderCell: (params) => {
          const { layout, recommendedLayout } = params.row;
          if (!layout && !recommendedLayout) {
            return;
          }
          const isActive = currentLayoutId === (layout?.id ?? recommendedLayout?.id);

          return (
            <Box display="flex" alignItems="center" justifyContent="center">
              {isActive ? (
                <EqualizerIcon color="primary" />
              ) : (
                <Tooltip placement="top" title={t("useLayout")}>
                  <IconButton
                    size="small"
                    className="play-button"
                    onClick={() => {
                      if (layout) {
                        onSelectLayout(layout);
                      } else if (recommendedLayout) {
                        onSelectRecommendedLayout(recommendedLayout);
                      }
                    }}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          );
        },
      },
      {
        field: "name",
        headerName: t("layoutName"),
        flex: 1,
        minWidth: 200,
        sortable: true,
        renderCell: (params) => {
          const { layout, recommendedLayout, name, category } = params.row;
          if (!layout && !recommendedLayout) {
            const displayName =
              category === "recommended"
                ? name === "h264"
                  ? t("h264")
                  : t("defaultLayoutFolder")
                : name;
            return (
              <Link
                className={classes.layoutNameBox}
                onClick={() => {
                  setSelectedFolder({ category, folder: name });
                }}
              >
                <FolderOutlinedIcon fontSize="small" />
                <Typography variant="body2" noWrap textOverflow="ellipsis">
                  {displayName}
                </Typography>
              </Link>
            );
          }
          return (
            <Link
              className={classes.layoutNameBox}
              onClick={() => {
                if (layout) {
                  onSelectLayout(layout);
                } else if (recommendedLayout) {
                  onSelectRecommendedLayout(recommendedLayout);
                }
              }}
            >
              {recommendedLayout ? (
                <AutoAwesomeOutlinedIcon fontSize="small" />
              ) : layout?.permission === "PERSONAL_WRITE" ? (
                <PersonOutlinedIcon fontSize="small" />
              ) : (
                <BusinessCenterOutlinedIcon fontSize="small" />
              )}
              <Typography variant="body2" noWrap textOverflow="ellipsis">
                {name}
              </Typography>
            </Link>
          );
        },
      },
      {
        field: "updateTime",
        headerName: t("updateTime"),
        width: 150,
        sortable: true,
        type: "number",
        align: "left",
        headerAlign: "left",
        renderCell: (params) => {
          const { layout, recommendedLayout } = params.row;
          if (!layout && !recommendedLayout) {
            return;
          }
          const savedAt = layout?.baseline.savedAt ?? recommendedLayout?.generatedAt;
          return savedAt ? dayjs(savedAt).fromNow() : "-";
        },
      },
      {
        field: "updater",
        headerName: t("updater"),
        width: 150,
        sortable: false,
        renderCell: (params) => {
          const { layout, recommendedLayout } = params.row;
          if (!layout && !recommendedLayout) {
            return;
          }
          return (
            <Typography variant="body2">
              {recommendedLayout ? t("systemRecommended") : layout?.baseline.modifierNickname}
            </Typography>
          );
        },
      },
      {
        field: "status",
        headerName: "",
        width: 20,
        sortable: false,
        align: "center",
        renderCell: (params) => {
          const { layout } = params.row;
          if (!layout?.working) {
            return undefined;
          }
          return <Box className={classes.workingIndicator} />;
        },
      },
      {
        field: "actions",
        type: "actions",
        headerName: "",
        width: 48,
        minWidth: 48,
        align: "right",
        getActions: (params) => {
          const { layout, recommendedLayout } = params.row;
          if (recommendedLayout) {
            return [
              <GridActionsCellItem
                key="copy"
                icon={<ContentCopyOutlinedIcon />}
                label={t("saveAPersonalCopy")}
                onClick={() => {
                  onCopyRecommendedLayout(recommendedLayout);
                }}
                showInMenu={false}
              />,
            ];
          }
          if (!layout) {
            return [];
          }

          return [
            <GridActionsCellItem
              key="menu"
              icon={<MoreVertIcon />}
              label="Menu"
              onClick={(event) => {
                handleMenuOpen(event, layout);
              }}
            />,
          ];
        },
      },
    ],
    [
      currentLayoutId,
      t,
      setSelectedFolder,
      onSelectLayout,
      onSelectRecommendedLayout,
      onCopyRecommendedLayout,
      handleMenuOpen,
      classes.layoutNameBox,
      classes.workingIndicator,
    ],
  );

  const items: {
    category: "all" | "personal" | "project" | "recommended";
    label: string;
    icon: React.ReactNode;
    folders?: string[];
  }[] = [
    {
      category: "all",
      label: t("allLayout"),
      icon: <SpaceDashboardOutlinedIcon />,
    },
    {
      category: "personal",
      label: t("personalLayout"),
      icon: <PersonOutlinedIcon />,
      folders: layouts?.personalFolders ?? [],
    },
    {
      category: "project",
      label: t("projectLayout"),
      icon: <BusinessCenterOutlinedIcon />,
      folders: layouts?.projectFolders ?? [],
    },
    ...(recommendedLayouts.length > 0
      ? [
          {
            category: "recommended" as const,
            label: t("recommendedLayout"),
            icon: <AutoAwesomeOutlinedIcon />,
            folders: ["default", "h264"],
          },
        ]
      : []),
  ];

  let empty: React.ReactNode | undefined;
  if (selectedFolder.category === "project") {
    if (loginStatus === "notLogin") {
      empty = <Typography>{t("pleaseLoginFirst", { ns: "openDialog" })}</Typography>;
    } else if (noProject) {
      empty = <Typography>{t("pleaseSelectProject")}</Typography>;
    }
  }

  return (
    <div className={classes.root}>
      <div className={classes.layoutContainer}>
        {/* Left Navigation Sidebar */}
        <div className={classes.sidebar}>
          <Box className={classes.overflowContainter}>
            <CreateLayoutItems
              onCreateLayout={onCreateLayout}
              personalFolders={layouts?.personalFolders ?? []}
              projectFolders={layouts?.projectFolders ?? []}
              supportsProjectWrite={supportsProjectWrite}
            />
            <Divider />
            <List className={classes.listPadding}>
              {items.map((item) => (
                <Fragment key={item.category}>
                  <ListItem disablePadding>
                    <ListItemButton
                      selected={
                        selectedFolder.category === item.category && selectedFolder.folder === ""
                      }
                      onClick={() => {
                        setSelectedFolder({ category: item.category, folder: "" });
                      }}
                    >
                      <ListItemIcon className={classes.listItemIcon}>{item.icon}</ListItemIcon>
                      <ListItemText primary={item.label} />
                    </ListItemButton>
                  </ListItem>

                  {item.folders?.map((folder) => (
                    <ListItem key={folder} disablePadding>
                      <ListItemButton
                        className={classes.folderItem}
                        selected={
                          selectedFolder.category === item.category &&
                          selectedFolder.folder === folder
                        }
                        onClick={() => {
                          setSelectedFolder({ category: item.category, folder });
                        }}
                      >
                        <ListItemIcon className={classes.listItemIcon}>
                          <FolderOutlinedIcon />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            item.category === "recommended"
                              ? folder === "h264"
                                ? t("h264")
                                : t("defaultLayoutFolder")
                              : folder
                          }
                          slotProps={{
                            primary: {
                              noWrap: true,
                              textOverflow: "ellipsis",
                            },
                          }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </Fragment>
              ))}
            </List>
          </Box>
        </div>

        {/* Right Content Area */}
        <div className={classes.contentArea}>
          <Box className={classes.boxPadding}>
            {/* Breadcrumb */}
            <Box className={classes.breadcrumbContainer}>
              <Breadcrumbs className={classes.breadcrumbs}>
                {selectedFolder.folder ? (
                  <Link
                    color="inherit"
                    underline="hover"
                    onClick={() => {
                      setSelectedFolder({ category: selectedFolder.category, folder: "" });
                    }}
                  >
                    {selectedFolder.category === "personal"
                      ? t("personalLayout")
                      : selectedFolder.category === "project"
                        ? t("projectLayout")
                        : selectedFolder.category === "recommended"
                          ? t("recommendedLayout")
                          : t("allLayout")}
                  </Link>
                ) : (
                  <Typography>
                    {selectedFolder.category === "personal"
                      ? t("personalLayout")
                      : selectedFolder.category === "project"
                        ? t("projectLayout")
                        : selectedFolder.category === "recommended"
                          ? t("recommendedLayout")
                          : t("allLayout")}
                  </Typography>
                )}
                {selectedFolder.folder && (
                  <Typography>
                    {selectedFolder.category === "recommended"
                      ? selectedFolder.folder === "h264"
                        ? t("h264")
                        : t("defaultLayoutFolder")
                      : selectedFolder.folder}
                  </Typography>
                )}
              </Breadcrumbs>
              <Box className={classes.closeButton}>
                <IconButton onClick={onClose}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </Box>

            {empty ?? (
              <>
                {/* Toolbar */}
                <Box className={classes.toolbar}>
                  <TextField
                    placeholder={t("layoutName")}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                    }}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon />
                          </InputAdornment>
                        ),
                      },
                    }}
                    size="small"
                    className={classes.searchField}
                  />
                </Box>

                {/* Layouts DataGrid */}
                <div className={classes.gridContainer}>
                  <DataGrid
                    rows={rows}
                    columns={columns}
                    sortModel={sortModel}
                    onSortModelChange={setSortModel}
                    disableRowSelectionOnClick
                    disableColumnResize
                    disableColumnMenu
                    hideFooter
                    className={classes.dataGrid}
                    rowSelection={false}
                    localeText={dataGridLocaleText}
                    density="compact"
                    getRowClassName={(params) =>
                      currentLayoutId === params.row.id ? "selected-row" : ""
                    }
                  />
                </div>
              </>
            )}
          </Box>
        </div>
      </div>

      {menu.layout && (
        <LayoutTableRowMenu
          anchorEl={menu.anchorEl}
          handleMenuClose={handleMenuClose}
          layout={menu.layout}
          onDeleteLayout={onDeleteLayout}
          onExportLayout={onExportLayout}
          onOverwriteLayout={onOverwriteLayout}
          onRevertLayout={onRevertLayout}
          handleOpenDialog={handleOpenDialog}
        />
      )}
      {dialog.layout && dialog.type === "rename" && (
        <RenameLayoutDialog
          layout={dialog.layout}
          open
          onClose={handleCloseDialog}
          onRenameLayout={onRenameLayout}
        />
      )}
      {dialog.layout && dialog.type === "copy" && (
        <CopyLayoutDialog
          personalFolders={layouts?.personalFolders ?? []}
          projectFolders={layouts?.projectFolders ?? []}
          layout={dialog.layout}
          open
          onClose={handleCloseDialog}
          onCreateLayout={onCreateLayout}
          supportsProjectWrite={supportsProjectWrite}
        />
      )}
      {dialog.layout && dialog.type === "move" && (
        <MoveToFolderDialog
          personalFolders={layouts?.personalFolders ?? []}
          projectFolders={layouts?.projectFolders ?? []}
          layout={dialog.layout}
          open
          onClose={handleCloseDialog}
          onMoveLayout={onMoveLayout}
        />
      )}
    </div>
  );
}
