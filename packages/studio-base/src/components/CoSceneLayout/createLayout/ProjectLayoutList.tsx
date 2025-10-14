// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Layout } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";
import {
  BusinessCenterOutlined as BusinessCenterOutlinedIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import {
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { LayoutPermission } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()((theme) => ({
  searchIcon: {
    color: theme.palette.text.secondary,
  },
  listContainer: {
    height: 240,
    overflow: "auto",
    borderLeft: `1px solid ${theme.palette.divider}`,
    borderRight: `1px solid ${theme.palette.divider}`,
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  listItem: {
    minHeight: 36,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    ":hover": {
      backgroundColor: theme.palette.action.hover,
    },
    "&:hover .MuiStack-root": {
      display: "flex",
    },
    ".MuiStack-root": {
      display: "none",
    },
  },
  listItemText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
}));
interface LayoutListProps {
  projectName: string;
  onChange: (data: Layout, permission: LayoutPermission) => void;
  supportsProjectWrite: boolean;
}

export function ProjectLayoutList({
  projectName,
  onChange,
  supportsProjectWrite,
}: LayoutListProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const consoleApi = useConsoleApi();
  const [searchText, setSearchText] = useState("");
  const { classes } = useStyles();

  const layouts = useAsync(async () => {
    if (!projectName) {
      return [];
    }

    const result = await consoleApi.listProjectLayouts({ parent: projectName });
    return result.projectLayouts;
  }, [projectName, consoleApi]);

  return (
    <Box>
      <TextField
        fullWidth
        label={t("layoutToCopy")}
        value={searchText}
        onChange={(e) => {
          setSearchText(e.target.value);
        }}
        placeholder={t("searchLayoutName")}
        slotProps={{
          input: {
            startAdornment: <SearchIcon fontSize="small" className={classes.searchIcon} />,
          },
        }}
      />
      <List dense className={classes.listContainer}>
        {layouts.value?.map((layout) => (
          <ListItem key={layout.name} className={classes.listItem} dense>
            <BusinessCenterOutlinedIcon fontSize="small" />
            <ListItemText className={classes.listItemText}>
              <Typography variant="body2" noWrap textOverflow="ellipsis">
                {layout.displayName}
              </Typography>
            </ListItemText>
            <Stack direction="row" gap={1} flex="none">
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  onChange(layout, "PERSONAL_WRITE");
                }}
              >
                {t("copyToPersonal")}
              </Button>
              {supportsProjectWrite && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    onChange(layout, "PROJECT_WRITE");
                  }}
                >
                  {t("copyToProject")}
                </Button>
              )}
            </Stack>
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
