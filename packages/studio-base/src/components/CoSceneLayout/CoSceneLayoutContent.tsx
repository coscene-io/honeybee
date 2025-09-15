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
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon,
} from "@mui/icons-material";
import {
  Box,
  Breadcrumbs,
  IconButton,
  InputAdornment,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CopyLayoutDialog } from "@foxglove/studio-base/components/CoSceneLayout/CopyLayoutDialog";
import { LayoutTableRow } from "@foxglove/studio-base/components/CoSceneLayout/LayoutTableRow";
import { LayoutTableRowMenu } from "@foxglove/studio-base/components/CoSceneLayout/LayoutTableRowMenu";
import { CreateLayoutButton } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateLayoutButton";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

import { RenameLayoutDialog } from "./RenameLayoutDialog";

const useStyles = makeStyles()((theme) => ({
  root: {
    height: "100%",
    width: "100%",
  },
  gridContainer: {
    display: "flex",
    height: "100%",
  },
  sidebar: {
    padding: theme.spacing(2),
    width: "20%",
    minWidth: 200,
    borderRight: `1px solid ${theme.palette.divider}`,
  },
  contentArea: {
    width: "80%",
    padding: theme.spacing(2),
    flex: 1,
  },
  listItemIcon: {
    minWidth: 26,
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
  tableHeaderCell: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    "&:hover .sort-icon": {
      visibility: "visible",
    },
  },
  sortIcon: {
    visibility: "hidden",
    "&.active": {
      visibility: "visible",
    },
  },

  emptyState: {
    textAlign: "center",
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(4),
  },

  boxPadding: {
    paddingBottom: theme.spacing(2),
  },
  listPadding: {
    paddingTop: 0,
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
}: {
  currentLayoutId?: LayoutID;
  supportsProjectWrite: boolean;
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    personalLayouts: Layout[];
    projectLayouts: Layout[];
  };
  onSelectLayout: (layout: Layout) => void;
  onDeleteLayout: (layout: Layout) => void;
  onRenameLayout: (layout: Layout, newName: string) => void;
  onExportLayout: (layout: Layout) => void;
  onOverwriteLayout: (layout: Layout) => void;
  onRevertLayout: (layout: Layout) => void;
  onCreateLayout: (params: CreateLayoutParams) => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();
  const [selectedFolder, setSelectedFolder] = useState<{
    category: "all" | "personal" | "project";
    folder: string;
  }>({ category: "personal", folder: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [{ sortBy, sortOrder }, setSort] = useState<{
    sortBy: "name" | "updateTime";
    sortOrder: "asc" | "desc";
  }>({ sortBy: "name", sortOrder: "asc" });

  const [menu, setMenu] = useState<{
    anchorEl: HTMLElement | undefined;
    layout: Layout | undefined;
  }>({ anchorEl: undefined, layout: undefined });

  const [dialog, setDialog] = useState<{
    type: "rename" | "copy" | undefined;
    layout: Layout | undefined;
  }>({ type: undefined, layout: undefined });

  const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>, layout: Layout) => {
    setMenu({ anchorEl: event.currentTarget, layout });
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenu({ anchorEl: undefined, layout: undefined });
  }, []);

  const handleOpenDialog = useCallback((type: "rename" | "copy", layout: Layout) => {
    setDialog({ type, layout });
  }, []);

  const handleCloseDialog = useCallback(() => {
    setDialog({ type: undefined, layout: undefined });
  }, []);

  // Filter layouts based on selection
  const filteredLayouts = useMemo(() => {
    if (!layouts) {
      return [];
    }

    let filtered: Layout[] =
      selectedFolder.category === "personal" ? layouts.personalLayouts : layouts.projectLayouts;

    if (selectedFolder.folder) {
      filtered = filtered.filter((l) => l.folder === selectedFolder.folder);
    }

    if (searchQuery) {
      filtered = filtered.filter((l) =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase().trim()),
      );
    }

    // Sort layouts
    filtered.sort((a, b) => {
      if (sortBy === "name") {
        return sortOrder === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      } else {
        const timeA = a.working?.savedAt ?? a.baseline.savedAt;
        const timeB = b.working?.savedAt ?? b.baseline.savedAt;
        if (!timeA && !timeB) {
          return 0;
        }
        if (!timeA) {
          return 1;
        }
        if (!timeB) {
          return -1;
        }
        return sortOrder === "asc"
          ? new Date(timeA).getTime() - new Date(timeB).getTime()
          : new Date(timeB).getTime() - new Date(timeA).getTime();
      }
    });

    return filtered;
  }, [layouts, selectedFolder.category, selectedFolder.folder, searchQuery, sortBy, sortOrder]);

  const items = [
    {
      category: "all",
      label: t("allLayout"),
      icon: <PersonOutlinedIcon />,
    },
    {
      category: "personal",
      label: t("personalLayout"),
      icon: <PersonOutlinedIcon />,
    },
    {
      category: "project",
      label: t("projectLayout"),
      icon: <BusinessCenterOutlinedIcon />,
    },
  ];

  return (
    <div className={classes.root}>
      <div className={classes.gridContainer}>
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

          <List className={classes.listPadding}>
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedFolder.category === "all"}
                onClick={() => {
                  setSelectedFolder({ category: "all", folder: "" });
                }}
              >
                <ListItemIcon className={classes.listItemIcon}>
                  <PersonOutlinedIcon />
                </ListItemIcon>
                <ListItemText primary={t("allLayout")} />
              </ListItemButton>
            </ListItem>

            {/* Personal Layouts */}
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedFolder.category === "personal"}
                onClick={() => {
                  setSelectedFolder({ category: "personal", folder: "" });
                }}
              >
                <ListItemIcon className={classes.listItemIcon}>
                  <PersonOutlinedIcon />
                </ListItemIcon>
                <ListItemText primary={t("personalLayout")} />
              </ListItemButton>
            </ListItem>

            {/* Personal Layout Folders */}
            {layouts?.personalFolders.map((folder) => (
              <ListItem key={folder} disablePadding>
                <ListItemButton
                  className={classes.folderItem}
                  selected={
                    selectedFolder.category === "personal" && selectedFolder.folder === folder
                  }
                  onClick={() => {
                    setSelectedFolder({ category: "personal", folder });
                  }}
                >
                  <ListItemIcon className={classes.listItemIcon}>
                    <FolderOutlinedIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={folder.length > 20 ? `${folder.substring(0, 20)}...` : folder}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                </ListItemButton>
              </ListItem>
            ))}

            {/* Project Layouts */}
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedFolder.category === "project"}
                onClick={() => {
                  setSelectedFolder({ category: "project", folder: "" });
                }}
              >
                <ListItemIcon className={classes.listItemIcon}>
                  <BusinessCenterOutlinedIcon />
                </ListItemIcon>
                <ListItemText primary={t("projectLayout")} />
              </ListItemButton>
            </ListItem>

            {/* Project Layout Folders */}
            {layouts?.projectFolders.map((folder) => (
              <ListItem key={folder} disablePadding>
                <ListItemButton
                  className={classes.folderItem}
                  selected={
                    selectedFolder.category === "project" && selectedFolder.folder === folder
                  }
                  onClick={() => {
                    setSelectedFolder({ category: "project", folder });
                  }}
                >
                  <ListItemIcon className={classes.listItemIcon}>
                    <FolderOutlinedIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={folder.length > 20 ? `${folder.substring(0, 20)}...` : folder}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </div>

        {/* Right Content Area */}
        <div className={classes.contentArea}>
          <Box className={classes.boxPadding}>
            {/* Breadcrumb */}
            <Breadcrumbs className={classes.breadcrumbs}>
              <Link
                color="inherit"
                underline="hover"
                onClick={() => {
                  setSelectedFolder({ category: "personal", folder: "" });
                }}
              >
                {selectedFolder.category === "personal" ? t("personalLayout") : t("projectLayout")}
              </Link>
              {selectedFolder.folder && <div>{selectedFolder.folder}</div>}
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

            {/* Layouts Table */}
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    <TableCell>
                      <Box
                        className={classes.tableHeaderCell}
                        onClick={() => {
                          setSort({
                            sortBy: "name",
                            sortOrder: sortBy === "name" && sortOrder === "asc" ? "desc" : "asc",
                          });
                        }}
                      >
                        {t("layoutName")}
                        <IconButton
                          size="small"
                          className={`sort-icon ${classes.sortIcon} ${
                            sortBy === "name" ? "active" : ""
                          }`}
                        >
                          {sortBy === "name" && sortOrder === "desc" ? (
                            <ArrowDownwardIcon />
                          ) : (
                            <ArrowUpwardIcon />
                          )}
                        </IconButton>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box
                        className={classes.tableHeaderCell}
                        onClick={() => {
                          setSort({
                            sortBy: "updateTime",
                            sortOrder:
                              sortBy === "updateTime" && sortOrder === "asc" ? "desc" : "asc",
                          });
                        }}
                      >
                        {t("updateTime")}
                        <IconButton
                          size="small"
                          className={`sort-icon ${classes.sortIcon} ${
                            sortBy === "updateTime" ? "active" : ""
                          }`}
                        >
                          {sortBy === "updateTime" && sortOrder === "desc" ? (
                            <ArrowDownwardIcon />
                          ) : (
                            <ArrowUpwardIcon />
                          )}
                        </IconButton>
                      </Box>
                    </TableCell>
                    <TableCell>{t("updater")}</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredLayouts.map((layout) => (
                    <LayoutTableRow
                      key={layout.id}
                      currentLayoutId={currentLayoutId}
                      layout={layout}
                      handleMenuOpen={handleMenuOpen}
                      onSelectLayout={onSelectLayout}
                      onOverwriteLayout={onOverwriteLayout}
                      onRevertLayout={onRevertLayout}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {filteredLayouts.length === 0 && (
              <Box className={classes.emptyState}>
                <Typography color="text.secondary">{t("noData")}</Typography>
              </Box>
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
    </div>
  );
}
