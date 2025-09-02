// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Business as BusinessIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Folder as FolderIcon,
  MoreVert as MoreVertIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  Sort as SortIcon,
} from "@mui/icons-material";
import {
  Avatar,
  Box,
  Breadcrumbs,
  DialogContent,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
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
import dayjs from "dayjs";
import { useState, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import { CreateLayoutButton } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/CreateLayoutButton";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()((theme) => ({
  root: {
    height: "100%",
  },
  content: {
    padding: 0,
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
  updaterCell: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    justifyContent: "flex-end",
  },
  actionsCell: {
    display: "flex",
    gap: theme.spacing(1),
    justifyContent: "center",
  },
  emptyState: {
    textAlign: "center",
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(4),
  },
  avatar: {
    width: 24,
    height: 24,
    fontSize: "0.75rem",
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
}: {
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    personalLayouts: Layout[];
    projectLayouts: Layout[];
  };
}): React.JSX.Element {
  const { classes } = useStyles();
  const [selectedCategory, setSelectedCategory] = useState<"personal" | "project">("personal");
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "updateTime">("updateTime");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | undefined>(undefined);

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

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(undefined);
  };

  const formatTimestamp = (timestamp: { seconds: number | bigint } | undefined) => {
    if (!timestamp) {
      return "未知时间";
    }
    const date = new Date(Number(timestamp.seconds) * 1000);
    return dayjs(date).format("YYYY-MM-DD HH:mm:ss");
  };

  if (!layouts) {
    return <div>No layouts</div>;
  }

  return (
    <div className={classes.root}>
      <DialogContent className={classes.content}>
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
                              setSortBy("updateTime");
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
                      <TableRow key={layout.id} hover>
                        <TableCell>{layout.displayName}</TableCell>
                        <TableCell align="right">
                          {formatTimestamp(
                            layout.working?.modifyTime ?? layout.baseline.modifyTime,
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Box className={classes.updaterCell}>
                            <Avatar className={classes.avatar}>U</Avatar>
                            <Typography variant="body2">user</Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          <Box className={classes.actionsCell}>
                            <IconButton size="small" onClick={handleMenuOpen}>
                              <MoreVertIcon />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
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
      </DialogContent>

      {/* Context Menu */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          重命名
        </MenuItem>
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          复制为个人布局
        </MenuItem>
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <BusinessIcon fontSize="small" />
          </ListItemIcon>
          复制为项目布局
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          删除
        </MenuItem>
      </Menu>
    </div>
  );
}
