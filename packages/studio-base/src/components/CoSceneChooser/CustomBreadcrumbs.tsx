// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { Breadcrumbs, Link, Typography, Button } from "@mui/material";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

import { CustomBreadcrumbsProps } from "./types";

const selectUser = (store: UserStore) => store.user;

export const CustomBreadcrumbs = memo<CustomBreadcrumbsProps>(
  ({ project, clearProject, record, clearRecord, type, recordType, setRecordType }) => {
    const { t } = useTranslation("cosGeneral");
    const currentUser = useCurrentUser(selectUser);

    const breadcrumbs = useMemo(() => {
      const items: React.JSX.Element[] = [];

      if (!project && !record) {
        items.push(
          <Typography key="project" color="text.primary">
            {t("project")}
          </Typography>,
        );
      } else if (project && !record) {
        items.push(
          <Link
            underline="hover"
            key="project-link"
            color="inherit"
            onClick={clearProject}
            style={{ cursor: "pointer" }}
          >
            {t("project")}
          </Link>,
          <Typography key="project-name" color="text.primary">
            {project.displayName}
          </Typography>,
        );
      } else if (project && record) {
        items.push(
          <Link
            underline="hover"
            key="project-link"
            color="inherit"
            onClick={() => {
              clearProject();
              clearRecord();
            }}
            style={{ cursor: "pointer" }}
          >
            {t("project")}
          </Link>,
          <Link
            underline="hover"
            key="project-name-link"
            color="inherit"
            onClick={clearRecord}
            style={{ cursor: "pointer" }}
          >
            {project.displayName}
          </Link>,
          <Typography key="record-title" color="text.primary">
            {record.title}
          </Typography>,
        );
      }

      return items;
    }, [project, record, clearProject, clearRecord, t]);

    const actionButton = useMemo(() => {
      if (type === "record" && !project && !record) {
        return (
          <Button
            variant="text"
            onClick={() => {
              window.open(currentUser?.targetSite, "_blank");
            }}
          >
            {t("toCreateProject", { ns: "appBar" })}
          </Button>
        );
      }

      if (type === "record" && project && !record) {
        return recordType === "create" ? (
          <Button
            variant="text"
            onClick={() => {
              setRecordType("select");
            }}
          >
            {t("selectRecord", { ns: "appBar" })}
          </Button>
        ) : (
          <Button
            variant="text"
            onClick={() => {
              setRecordType("create");
            }}
          >
            {t("createRecord", { ns: "appBar" })}
          </Button>
        );
      }

      return undefined;
    }, [type, project, record, recordType, setRecordType, currentUser?.targetSite, t]);

    return (
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
          {breadcrumbs}
        </Breadcrumbs>
        {actionButton}
      </Stack>
    );
  },
);

CustomBreadcrumbs.displayName = "CustomBreadcrumbs";
