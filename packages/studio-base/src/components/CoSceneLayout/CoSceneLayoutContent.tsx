// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Business as BusinessIcon,
  Folder as FolderIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  Sort as SortIcon,
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
import { useState, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import { LayoutMenu } from "@foxglove/studio-base/components/CoSceneLayout/LayoutMenu";
import { LayoutTableRow } from "@foxglove/studio-base/components/CoSceneLayout/LayoutTableRow";
import { CreateLayoutButton } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateLayoutButton";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()((theme) => ({
  root: {
    height: "100%",
  },
  gridContainer: {
    display: "flex",
    height: "100%",
  },
  sidebar: {
    width: "25%",
    borderRight: `1px solid ${theme.palette.divider}`,
  },
  contentArea: {
    width: "75%",
    minWidth: 800,
  },
  listItemButton: {
    "&.Mui-selected": {
      backgroundColor: theme.palette.primary.light,
      color: theme.palette.primary.main,
    },
  },
  listItemButtonPersonal: {
    "&.Mui-selected": {
      backgroundColor: theme.palette.primary.light,
      color: theme.palette.primary.main,
    },
    backgroundColor: "transparent",
    color: "inherit",
  },
  listItemButtonPersonalSelected: {
    backgroundColor: theme.palette.primary.light,
    color: theme.palette.primary.main,
  },
  listItemButtonProject: {
    "&.Mui-selected": {
      backgroundColor: theme.palette.primary.light,
      color: theme.palette.primary.main,
    },
    backgroundColor: "transparent",
    color: "inherit",
  },
  listItemButtonProjectSelected: {
    backgroundColor: theme.palette.primary.light,
    color: theme.palette.primary.main,
  },
  listItemIcon: {
    color: "inherit",
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
  },
  tableHeaderCell: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  },

  emptyState: {
    textAlign: "center",
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(4),
  },

  boxPadding: {
    padding: theme.spacing(2),
  },
  listPadding: {
    paddingTop: 0,
  },
}));

export function CoSceneLayoutContent({
  layouts,
  onSelectLayout,
}: {
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    personalLayouts: Layout[];
    projectLayouts: Layout[];
  };
  onSelectLayout: (layout: Layout) => Promise<void>;
}): React.JSX.Element {
  const { classes } = useStyles();
  const [selectedCategory, setSelectedCategory] = useState<"personal" | "project">("personal");
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "updateTime">("updateTime");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [menu, setMenu] = useState<{
    anchorEl: HTMLElement | undefined;
    layout: Layout | undefined;
  }>({ anchorEl: undefined, layout: undefined });

  // Filter layouts based on selection
  const filteredLayouts = useMemo(() => {
    if (!layouts) {
      return [];
    }

    let filtered: Layout[] =
      selectedCategory === "personal" ? layouts.personalLayouts : layouts.projectLayouts;

    if (selectedFolder) {
      filtered = filtered.filter((l) => l.folder === selectedFolder);
    }

    if (searchQuery) {
      filtered = filtered.filter((l) =>
        l.displayName.toLowerCase().includes(searchQuery.toLowerCase().trim()),
      );
    }

    // Sort layouts
    filtered.sort((a, b) => {
      if (sortBy === "name") {
        return sortOrder === "asc"
          ? a.displayName.localeCompare(b.displayName)
          : b.displayName.localeCompare(a.displayName);
      } else {
        const timeA = a.working?.modifyTime ?? a.baseline.modifyTime;
        const timeB = b.working?.modifyTime ?? b.baseline.modifyTime;
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
          ? Number(timeA.seconds) - Number(timeB.seconds)
          : Number(timeB.seconds) - Number(timeA.seconds);
      }
    });

    return filtered;
  }, [layouts, selectedCategory, selectedFolder, searchQuery, sortBy, sortOrder]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, layout: Layout) => {
    setMenu({ anchorEl: event.currentTarget, layout });
  };

  const handleMenuClose = () => {
    setMenu({ anchorEl: undefined, layout: undefined });
  };

  if (!layouts) {
    return <div>No layouts</div>;
  }

  return (
    <div className={classes.root}>
      <div className={classes.gridContainer}>
        {/* Left Navigation Sidebar */}
        <div className={classes.sidebar}>
          <Box className={classes.boxPadding}>
            <CreateLayoutButton />
          </Box>

          <List className={classes.listPadding}>
            {/* Personal Layouts */}
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedCategory === "personal"}
                onClick={() => {
                  setSelectedCategory("personal");
                  setSelectedFolder("");
                }}
                className={`${classes.listItemButton} ${
                  selectedCategory === "personal"
                    ? classes.listItemButtonPersonalSelected
                    : classes.listItemButtonPersonal
                }`}
              >
                <ListItemIcon className={classes.listItemIcon}>
                  <PersonIcon />
                </ListItemIcon>
                <ListItemText primary="个人布局" />
              </ListItemButton>
            </ListItem>

            {/* Personal Layout Folders */}
            {layouts.personalFolders.map((folder) => (
              <ListItem key={folder} disablePadding className={classes.folderItem}>
                <ListItemButton
                  selected={selectedFolder === folder}
                  onClick={() => {
                    setSelectedFolder(folder);
                  }}
                >
                  <ListItemIcon>
                    <FolderIcon />
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
                selected={selectedCategory === "project"}
                onClick={() => {
                  setSelectedCategory("project");
                  setSelectedFolder("");
                }}
                className={`${classes.listItemButton} ${
                  selectedCategory === "project"
                    ? classes.listItemButtonProjectSelected
                    : classes.listItemButtonProject
                }`}
              >
                <ListItemIcon className={classes.listItemIcon}>
                  <BusinessIcon />
                </ListItemIcon>
                <ListItemText primary="项目布局" />
              </ListItemButton>
            </ListItem>

            {/* Project Layout Folders */}
            {layouts.projectFolders.map((folder) => (
              <ListItem key={folder} disablePadding className={classes.folderItem}>
                <ListItemButton
                  selected={selectedFolder === folder}
                  onClick={() => {
                    setSelectedFolder(folder);
                  }}
                >
                  <ListItemIcon>
                    <FolderIcon />
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
              <Link color="inherit" href="#" underline="hover">
                {selectedCategory === "personal" ? "个人布局" : "项目布局"}
              </Link>
              {selectedFolder && (
                <Link color="inherit" href="#" underline="hover">
                  {selectedFolder}
                </Link>
              )}
            </Breadcrumbs>

            {/* Toolbar */}
            <Box className={classes.toolbar}>
              <TextField
                placeholder="布局名称"
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
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>布局名称</TableCell>
                    <TableCell align="right">
                      <Box className={classes.tableHeaderCell}>
                        更新时间
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (sortBy === "updateTime") {
                              setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                            } else {
                              setSortBy("updateTime");
                            }
                          }}
                        >
                          <SortIcon />
                        </IconButton>
                      </Box>
                    </TableCell>
                    <TableCell align="right">更新者</TableCell>
                    <TableCell align="center">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredLayouts.map((layout) => (
                    <LayoutTableRow
                      key={layout.id}
                      layout={layout}
                      handleMenuOpen={handleMenuOpen}
                      onSelectLayout={onSelectLayout}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {filteredLayouts.length === 0 && (
              <Box className={classes.emptyState}>
                <Typography color="text.secondary">暂无布局数据</Typography>
              </Box>
            )}
          </Box>
        </div>
      </div>

      {menu.layout && (
        <LayoutMenu
          anchorEl={menu.anchorEl}
          handleMenuClose={handleMenuClose}
          layout={menu.layout}
        />
      )}
    </div>
  );
}
