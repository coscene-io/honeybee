// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Layout } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";
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
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { LayoutPermission } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

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

  const layouts = useAsync(async () => {
    if (!projectName) {
      return [];
    }

    const result = await consoleApi.listProjectLayouts({ parent: projectName });
    return result.projectLayouts;
  }, [projectName, consoleApi]);

  // const getProjectLayout = useCallback(
  //   async (layoutName: string, displayName?: string) => {
  //     if (!layoutName) {
  //       // onChange(undefined, undefined);
  //       return;
  //     }

  //     try {
  //       const result = await consoleApi.getProjectLayout({ name: layoutName });
  //       const data = result.data?.toJson() as LayoutData;
  //       onChange(data, displayName);
  //     } catch (error) {
  //       console.error(error);
  //       // onChange(undefined, undefined);c
  //     }

  //     return;
  //   },
  //   [consoleApi, onChange],
  // );

  return (
    <Box>
      <TextField
        label={t("layoutToCopy")}
        value={searchText}
        onChange={(e) => {
          setSearchText(e.target.value);
        }}
      />
      <List>
        {layouts.value?.map((layout) => (
          <ListItem key={layout.name}>
            <ListItemText>{layout.displayName}</ListItemText>
            <div>
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
            </div>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  // return (
  //   <Autocomplete
  //     options={options.value ?? []}
  //     onChange={(_event, option) => {
  //       void getProjectLayout(option?.value, option?.label);
  //     }}
  //     renderInput={(params) => (
  //       <TextField required {...params} label={t("layoutToCopy")} error={error} />
  //     )}
  //   />
  // );
}
