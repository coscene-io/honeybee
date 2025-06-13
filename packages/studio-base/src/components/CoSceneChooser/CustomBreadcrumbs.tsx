// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import FolderIcon from "@mui/icons-material/Folder";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { Breadcrumbs, Link, Typography, Button } from "@mui/material";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

import { CustomBreadcrumbsProps } from "./types";

const selectUser = (store: UserStore) => store.user;

export const CustomBreadcrumbs = memo<CustomBreadcrumbsProps>(
  ({
    project,
    clearProject,
    record,
    clearRecord,
    mode,
    setRecordType,
    currentFolderPath,
    onNavigateToFolder,
    listType,
  }) => {
    const { t } = useTranslation("cosGeneral");
    const currentUser = useCurrentUser(selectUser);

    const breadcrumbs = useMemo(() => {
      const items: React.JSX.Element[] = [];

      // Determine breadcrumb display logic based on mode
      if (mode === "select-files-from-project") {
        // select-files-from-project mode: Project → Files
        if (!project) {
          items.push(
            <Typography key="project" color="text.primary">
              {t("project")}
            </Typography>,
          );
        } else {
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
          );

          if (listType === "files") {
            items.push(
              <Link
                underline="hover"
                key="project-name-link"
                color="inherit"
                onClick={() => onNavigateToFolder?.([])}
                style={{ cursor: "pointer" }}
              >
                {project.displayName}
              </Link>,
            );
          } else {
            items.push(
              <Typography key="project-name" color="text.primary">
                {project.displayName}
              </Typography>,
            );
          }
        }
      } else if (mode === "select-record" || mode === "create-record") {
        // select-record and create-record modes: Project → Record
        if (!project) {
          items.push(
            <Typography key="project" color="text.primary">
              {t("project")}
            </Typography>,
          );
        } else if (!record) {
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
        } else {
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
      } else {
        // select-files-from-record mode: Project → Record → Files
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
          );

          if (listType === "files") {
            items.push(
              <Link
                underline="hover"
                key="record-title-link"
                color="inherit"
                onClick={() => onNavigateToFolder?.([])}
                style={{ cursor: "pointer" }}
              >
                {record.title}
              </Link>,
            );
          } else {
            items.push(
              <Typography key="record-title" color="text.primary">
                {record.title}
              </Typography>,
            );
          }
        }
      }

      // 添加文件夹路径面包屑
      if (currentFolderPath && currentFolderPath.length > 0) {
        currentFolderPath.forEach((folder, index) => {
          const isLast = index === currentFolderPath.length - 1;
          const pathToFolder = currentFolderPath.slice(0, index + 1);

          if (isLast) {
            items.push(
              <Typography
                key={`folder-${index}`}
                color="text.primary"
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                <FolderIcon fontSize="small" />
                {folder}
              </Typography>,
            );
          } else {
            items.push(
              <Link
                key={`folder-${index}`}
                underline="hover"
                color="inherit"
                onClick={() => onNavigateToFolder?.(pathToFolder)}
                style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              >
                <FolderIcon fontSize="small" />
                {folder}
              </Link>,
            );
          }
        });
      }

      return items;
    }, [
      project,
      record,
      clearProject,
      clearRecord,
      t,
      mode,
      currentFolderPath,
      onNavigateToFolder,
      listType,
    ]);

    const actionButton = useMemo(() => {
      if ((mode === "select-record" || mode === "create-record") && !project && !record) {
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

      // Only show record-related buttons in modes that require record operations
      if (
        (mode === "select-record" ||
          mode === "create-record" ||
          mode === "select-files-from-record") &&
        project &&
        !record
      ) {
        return mode === "create-record" ? (
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
    }, [mode, project, record, setRecordType, currentUser?.targetSite, t]);

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
