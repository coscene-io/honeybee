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
  Dashboard as DashboardIcon,
  PlayArrow as PlayArrowIcon,
  Equalizer as EqualizerIcon,
  MoreVert as MoreVertIcon,
} from "@mui/icons-material";
import {
  Avatar,
  Box,
  Breadcrumbs,
  Button,
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
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useState, useMemo, useCallback, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CopyLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/CopyLayoutDialog";
import { LayoutTableRowMenu } from "@foxglove/studio-base/components/CoSceneLayout/LayoutTableRowMenu";
import { MoveToFolderDialog } from "@foxglove/studio-base/components/CoSceneLayout/MoveToFolderDialog";
import { RenameLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/RenameLayoutDialog";
import { CreateLayoutButton } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateLayoutButton";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import {
  Layout,
  layoutIsProject,
  layoutIsRead,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";

dayjs.extend(relativeTime);

interface LayoutWithFolder {
  id: string;
  name: string;
  folder: string;
  isFolder: boolean;
  category: "personal" | "project";
  layout?: Layout;
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
  folderItem: {
    paddingLeft: theme.spacing(4),
  },
  breadcrumbs: {
    marginBottom: theme.spacing(2),
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
    height: "calc(100vh - 190px)",
    width: "100%",
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
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();
  const [selectedFolder, setSelectedFolder] = useState<{
    category: "all" | "personal" | "project";
    folder: string;
  }>({ category: "all", folder: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortModel, setSortModel] = useState<GridSortModel>([]);

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
    if (!layouts) {
      return [];
    }

    let filtered: Layout[] = layouts.allLayouts;
    if (selectedFolder.category === "personal") {
      filtered = filtered.filter((l) => l.permission === "PERSONAL_WRITE");
    } else if (selectedFolder.category === "project") {
      filtered = filtered.filter((l) => layoutIsProject(l));
    }

    let folders: string[] = [];
    if (searchQuery) {
      filtered = filtered.filter((l) =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase().trim()),
      );
    } else {
      filtered = filtered.filter((l) => l.folder === selectedFolder.folder);

      if (!selectedFolder.folder) {
        if (selectedFolder.category === "personal") {
          folders = layouts.personalFolders;
        } else if (selectedFolder.category === "project") {
          folders = layouts.projectFolders;
        }
      }
    }

    return [
      ...folders
        .map((folder) => {
          return {
            id: Math.random().toString(),
            name: folder,
            folder,
            isFolder: true,
            category: selectedFolder.category as "personal" | "project",
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
    ];
  }, [layouts, selectedFolder.category, selectedFolder.folder, searchQuery]);

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
          const { layout } = params.row;
          if (!layout) {
            return;
          }
          const isActive = currentLayoutId === layout.id;

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
                      onSelectLayout(layout);
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
          const { layout, name, category } = params.row;
          if (!layout) {
            return (
              <Box
                display="flex"
                alignItems="center"
                gap={1}
                onClick={() => {
                  setSelectedFolder({ category, folder: name });
                }}
              >
                <FolderOutlinedIcon fontSize="small" />
                <Typography variant="body2">{name}</Typography>
              </Box>
            );
          }
          return (
            <Box display="flex" alignItems="center" gap={1}>
              {layout.permission === "PERSONAL_WRITE" ? (
                <PersonOutlinedIcon fontSize="small" />
              ) : (
                <BusinessCenterOutlinedIcon fontSize="small" />
              )}
              <Typography variant="body2">{layout.name}</Typography>
            </Box>
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
          const { layout } = params.row;
          if (!layout) {
            return;
          }
          const savedAt = layout.baseline.savedAt;
          return savedAt ? dayjs(savedAt).fromNow() : "-";
        },
      },
      {
        field: "updater",
        headerName: t("updater"),
        width: 200,
        sortable: false,
        renderCell: (params) => {
          const { layout } = params.row;
          if (!layout) {
            return;
          }
          return (
            <Box display="flex" alignItems="center" gap={1}>
              <Avatar
                style={{ width: 24, height: 24, fontSize: "0.75rem" }}
                src={layout.baseline.modifierAvatar}
              >
                {layout.baseline.modifierNickname?.split("/").pop()}
              </Avatar>
              <Typography variant="body2">{layout.baseline.modifierNickname}</Typography>
            </Box>
          );
        },
      },
      {
        field: "actions",
        type: "actions",
        headerName: "",
        width: 120,
        flex: 1,
        align: "right",
        getActions: (params) => {
          const { layout } = params.row;
          if (!layout) {
            return [];
          }

          const deletedOnServer = layout.syncInfo?.status === "remotely-deleted";
          const hasModifications = layout.working != undefined;
          const isRead = layoutIsRead(layout);

          const actions = [];

          if (hasModifications) {
            actions.push(
              <GridActionsCellItem
                key="save"
                icon={
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={deletedOnServer || isRead}
                    onClick={() => {
                      onOverwriteLayout(layout);
                    }}
                  >
                    {t("saveChanges")}
                  </Button>
                }
                label={t("saveChanges")}
                disabled={deletedOnServer || isRead}
              />,
              <GridActionsCellItem
                key="revert"
                icon={
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={deletedOnServer}
                    onClick={() => {
                      onRevertLayout(layout);
                    }}
                  >
                    {t("revert")}
                  </Button>
                }
                label={t("revert")}
                disabled={deletedOnServer}
              />,
            );
          }

          actions.push(
            <GridActionsCellItem
              key="menu"
              icon={<MoreVertIcon />}
              label="Menu"
              onClick={(event) => {
                handleMenuOpen(event, layout);
              }}
            />,
          );

          return actions;
        },
      },
    ],
    [
      currentLayoutId,
      t,
      setSelectedFolder,
      onSelectLayout,
      onOverwriteLayout,
      onRevertLayout,
      handleMenuOpen,
    ],
  );

  const items: {
    category: "all" | "personal" | "project";
    label: string;
    icon: React.ReactNode;
    folders?: string[];
  }[] = [
    {
      category: "all",
      label: t("allLayout"),
      icon: <DashboardIcon />,
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
  ];

  return (
    <div className={classes.root}>
      <div className={classes.layoutContainer}>
        {/* Left Navigation Sidebar */}
        <div className={classes.sidebar}>
          <Box className={classes.boxPadding}>
            <CreateLayoutButton
              onCreateLayout={onCreateLayout}
              personalFolders={layouts?.personalFolders ?? []}
              projectFolders={layouts?.projectFolders ?? []}
              supportsProjectWrite={supportsProjectWrite}
            />
          </Box>

          <Box className={classes.overflowContainter}>
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
                        <ListItemText primary={folder} />
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
                    : t("allLayout")}
                </Link>
              ) : (
                <Typography>
                  {selectedFolder.category === "personal"
                    ? t("personalLayout")
                    : selectedFolder.category === "project"
                    ? t("projectLayout")
                    : t("allLayout")}
                </Typography>
              )}
              {selectedFolder.folder && <Typography>{selectedFolder.folder}</Typography>}
            </Breadcrumbs>

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
                getRowClassName={(params) =>
                  currentLayoutId === params.row.id ? "selected-row" : ""
                }
              />
            </div>
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
