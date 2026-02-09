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
import { memo, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

import { CustomBreadcrumbsProps } from "./types";

const selectUser = (store: UserStore) => store.user;

// Helper component for clickable breadcrumb link
const BreadcrumbLink = ({
  itemKey,
  onClick,
  children,
}: {
  itemKey: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <Link
    underline="hover"
    key={itemKey}
    color="inherit"
    onClick={onClick}
    style={{ cursor: "pointer" }}
  >
    {children}
  </Link>
);

// Helper component for static breadcrumb text
const BreadcrumbText = ({ itemKey, children }: { itemKey: string; children: React.ReactNode }) => (
  <Typography key={itemKey} color="text.primary">
    {children}
  </Typography>
);

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
    disableProjectSelect,
    disableCreateRecord,
  }) => {
    const { t } = useTranslation("general");
    const currentUser = useCurrentUser(selectUser);

    // Check if project navigation should be disabled
    const isProjectDisabled =
      disableProjectSelect === true || mode === "select-record-from-target-project";

    const handleClearAll = useCallback(() => {
      clearProject();
      clearRecord();
    }, [clearProject, clearRecord]);

    const handleResetFolder = useCallback(() => {
      onNavigateToFolder?.([]);
    }, [onNavigateToFolder]);

    const breadcrumbs = useMemo(() => {
      const items: React.JSX.Element[] = [];

      // Helper to add project breadcrumb
      const addProjectLabel = (onClick?: () => void) => {
        if (onClick) {
          items.push(
            <BreadcrumbLink key="project-link" itemKey="project-link" onClick={onClick}>
              {t("project")}
            </BreadcrumbLink>,
          );
        } else {
          items.push(
            <BreadcrumbText key="project" itemKey="project">
              {t("project")}
            </BreadcrumbText>,
          );
        }
      };

      // Helper to add project name breadcrumb
      const addProjectName = (onClick?: () => void) => {
        if (!project) {
          return;
        }
        if (onClick) {
          items.push(
            <BreadcrumbLink key="project-name-link" itemKey="project-name-link" onClick={onClick}>
              {project.displayName}
            </BreadcrumbLink>,
          );
        } else {
          items.push(
            <BreadcrumbText key="project-name" itemKey="project-name">
              {project.displayName}
            </BreadcrumbText>,
          );
        }
      };

      // Helper to add record breadcrumb
      const addRecordTitle = (onClick?: () => void) => {
        if (!record) {
          return;
        }
        if (onClick) {
          items.push(
            <BreadcrumbLink key="record-title-link" itemKey="record-title-link" onClick={onClick}>
              {record.title}
            </BreadcrumbLink>,
          );
        } else {
          items.push(
            <BreadcrumbText key="record-title" itemKey="record-title">
              {record.title}
            </BreadcrumbText>,
          );
        }
      };

      // Build breadcrumbs based on mode
      if (mode === "select-files-from-project") {
        // Project → Files
        if (!project) {
          addProjectLabel();
        } else {
          addProjectLabel(clearProject);
          addProjectName(listType === "files" ? handleResetFolder : undefined);
        }
      } else if (isProjectDisabled) {
        // select-record-from-target-project or disableProjectSelect: no project navigation
        if (project) {
          addProjectName(record ? clearRecord : undefined);
          if (record) {
            addRecordTitle(listType === "files" ? handleResetFolder : undefined);
          }
        }
      } else if (mode === "select-record" || mode === "create-record") {
        // Project → Record
        if (!project) {
          addProjectLabel();
        } else if (!record) {
          addProjectLabel(clearProject);
          addProjectName();
        } else {
          addProjectLabel(handleClearAll);
          addProjectName(clearRecord);
          addRecordTitle();
        }
      } else {
        // select-files-from-record: Project → Record → Files
        if (!project) {
          addProjectLabel();
        } else if (!record) {
          addProjectLabel(clearProject);
          addProjectName();
        } else {
          addProjectLabel(handleClearAll);
          addProjectName(clearRecord);
          addRecordTitle(listType === "files" ? handleResetFolder : undefined);
        }
      }

      // Add folder path breadcrumbs
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
      handleClearAll,
      handleResetFolder,
      t,
      mode,
      isProjectDisabled,
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
        ) : disableCreateRecord !== true ? (
          <Button
            variant="text"
            onClick={() => {
              setRecordType("create");
            }}
          >
            {t("createRecord", { ns: "appBar" })}
          </Button>
        ) : undefined;
      }

      return undefined;
    }, [mode, project, record, setRecordType, currentUser?.targetSite, t, disableCreateRecord]);

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
