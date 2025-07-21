// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

/**
 * ChooserComponent supports four selection modes:
 *
 * 1. "select-files-from-record": Project → Record → Files
 *    - User first selects a project
 *    - Then selects a record under that project
 *    - Finally selects files under that record
 *    - Suitable for scenarios requiring precise location of files in specific records
 *
 * 2. "select-record": Project → Record (select existing record)
 *    - User first selects a project
 *    - Then selects an existing record under that project
 *    - Suitable for scenarios requiring selection of existing records
 *
 * 3. "create-record": Project → Record (create new record)
 *    - User first selects a project
 *    - Then creates a new record
 *    - Suitable for scenarios requiring creation of new records, such as file uploads
 *
 * 4. "select-files-from-project": Project → Files
 *    - User first selects a project
 *    - Then directly selects all files under that project (cross-record)
 *    - Suitable for scenarios requiring file selection from entire project
 *
 * Usage examples:
 * ```tsx
 * // Mode 1: Select files from record
 * <ChooserComponent
 *   mode="select-files-from-record"
 *   // ... other props
 * />
 *
 * // Mode 2: Select existing record
 * <ChooserComponent
 *   mode="select-record"
 *   // ... other props
 * />
 *
 * // Mode 3: Create new record
 * <ChooserComponent
 *   mode="create-record"
 *   // ... other props
 * />
 *
 * // Mode 4: Select files from project (cross-record)
 * <ChooserComponent
 *   mode="select-files-from-project"
 *   // ... other props
 * />
 * ```
 */

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { ListUserProjectsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { ListRecordsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { ListFilesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_pb";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import {
  List,
  ListItem,
  ListItemButton,
  TextField,
  IconButton,
  ListItemText,
  TablePagination,
} from "@mui/material";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { CreateRecordForm } from "@foxglove/studio-base/components/CoSceneChooser/CreateRecordForm";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  SerializeOption,
  BinaryOperator,
  CosQuery,
  checkBagFileSupported,
} from "@foxglove/studio-base/util/coscene";
import { QueryFields } from "@foxglove/studio-base/util/queries";

import { CustomBreadcrumbs } from "./CustomBreadcrumbs";
import { SelectFilesList } from "./SelectFilesList";
import { usePagination } from "./hooks/usePagination";
import { BaseChooserProps, ListType, SelectedFile } from "./types";

const selectUser = (store: UserStore) => store.user;

// Sub-components
interface ProjectsListProps {
  projects: Project[];
  onProjectSelect: (project: Project) => void;
}

const ProjectsList = ({ projects, onProjectSelect }: ProjectsListProps) => (
  <List>
    {projects.map((project) => (
      <ListItem key={project.name} disablePadding>
        <ListItemButton
          role={undefined}
          onClick={() => {
            onProjectSelect(project);
          }}
          dense
        >
          <ListItemText id={project.name} primary={project.displayName} />
        </ListItemButton>
      </ListItem>
    ))}
  </List>
);

interface RecordsListProps {
  records: Record[];
  selectedRecord?: Record;
  onRecordSelect: (record: Record) => void;
}

const RecordsList = ({ records, selectedRecord, onRecordSelect }: RecordsListProps) => (
  <List>
    {records.map((record) => (
      <ListItem key={record.name} disablePadding>
        <ListItemButton
          selected={selectedRecord?.name === record.name}
          role={undefined}
          onClick={() => {
            onRecordSelect(record);
          }}
          dense
        >
          <ListItemText id={record.name} primary={record.title} />
        </ListItemButton>
      </ListItem>
    ))}
  </List>
);

export function ChooserComponent({
  setTargetInfo,
  mode,
  files,
  setFiles,
  checkFileSupportedFunc,
  defaultRecordDisplayName,
  defaultProject,
  createRecordConfirmText,
}: BaseChooserProps): React.JSX.Element {
  const { t } = useTranslation("cosGeneral");
  const userInfo = useCurrentUser(selectUser);
  const consoleApi = useConsoleApi();

  const [recordType, setRecordType] = useState<"create" | "select">(
    mode === "create-record" ? "create" : "select",
  );
  const [project, setProject] = useState<Project | undefined>(defaultProject);
  const [record, setRecord] = useState<Record | undefined>(undefined);

  // 文件夹导航状态
  const [currentFolderPath, setCurrentFolderPath] = useState<readonly string[]>([]);

  // Pagination hooks for different list types
  const projectsPagination = usePagination(20);
  const recordsPagination = usePagination(20);
  const filesPagination = usePagination(20);

  // Determine current list type based on mode
  const listType = useMemo<ListType>(() => {
    if (!project) {
      return "projects";
    }

    // select-files-from-project mode: show files directly after project selection
    if (mode === "select-files-from-project") {
      return "files";
    }

    // select-record and create-record modes: show records after project selection
    if (mode === "select-record" || mode === "create-record") {
      return "records";
    }

    // select-files-from-record mode: Project > Record > Files
    if (!record) {
      return "records";
    }
    return "files";
  }, [project, record, mode]);

  // Get current pagination state based on list type
  const currentPagination = useMemo(() => {
    switch (listType) {
      case "projects":
        return projectsPagination;
      case "records":
        return recordsPagination;
      case "files":
        return filesPagination;
      default:
        return projectsPagination;
    }
  }, [listType, projectsPagination, recordsPagination, filesPagination]);

  // Reset pagination when navigating
  const resetAllPagination = useCallback(() => {
    projectsPagination.resetState();
    recordsPagination.resetState();
    filesPagination.resetState();
  }, [projectsPagination, recordsPagination, filesPagination]);

  // API calls
  const [projects, syncProjects] = useAsyncFn(async () => {
    const userId = userInfo?.userId;
    if (!userId || listType !== "projects") {
      return new ListUserProjectsResponse();
    }

    const filter = CosQuery.Companion.empty();
    filter.setField(
      QueryFields.DISPLAY_NAME,
      [BinaryOperator.HAS],
      [projectsPagination.debouncedFilter],
    );

    try {
      return await consoleApi.listUserProjects({
        userId,
        filter: filter.toQueryString(new SerializeOption(false)),
        pageSize: projectsPagination.pageSize,
        currentPage: projectsPagination.page,
      });
    } catch (error) {
      console.error("Failed to load projects:", error);
      return new ListUserProjectsResponse();
    }
  }, [
    consoleApi,
    listType,
    projectsPagination.debouncedFilter,
    projectsPagination.page,
    projectsPagination.pageSize,
    userInfo?.userId,
  ]);

  const [records, syncRecords] = useAsyncFn(async () => {
    if (!project || listType !== "records") {
      return new ListRecordsResponse();
    }

    const filter = CosQuery.Companion.empty();
    filter.setField(QueryFields.TITLE, [BinaryOperator.HAS], [recordsPagination.debouncedFilter]);

    return await consoleApi.listRecord({
      projectName: project.name,
      filter: filter.toQueryString(new SerializeOption(false)),
      pageSize: recordsPagination.pageSize,
      currentPage: recordsPagination.page,
    });
  }, [
    consoleApi,
    listType,
    project,
    recordsPagination.debouncedFilter,
    recordsPagination.page,
    recordsPagination.pageSize,
  ]);

  const [filesList, syncFilesList] = useAsyncFn(async () => {
    if (listType !== "files") {
      return new ListFilesResponse();
    }

    const filter = CosQuery.Companion.empty();

    if (filesPagination.debouncedFilter.length > 0) {
      filter.setField(QueryFields.PATH, [BinaryOperator.EQ], [filesPagination.debouncedFilter]);
    }

    if (currentFolderPath.length > 0) {
      filter.setField(QueryFields.DIR, [BinaryOperator.EQ], [currentFolderPath.join("/")]);
    }

    // select-files-from-project mode: get files directly from project
    // Note: This requires using all records under the project to get files, or using specific project file API
    if (mode === "select-files-from-project" && project) {
      return await consoleApi.listFiles({
        parent: project.name,
        pageSize: filesPagination.pageSize,
        filter: filter.toQueryString(new SerializeOption(false)),
        currentPage: filesPagination.page,
      });
    }

    // select-files-from-record mode: get files from record
    if (record) {
      return await consoleApi.listFiles({
        parent: record.name,
        pageSize: filesPagination.pageSize,
        filter: filter.toQueryString(new SerializeOption(false)),
        currentPage: filesPagination.page,
      });
    }

    return new ListFilesResponse();
  }, [
    consoleApi,
    filesPagination.debouncedFilter,
    filesPagination.page,
    filesPagination.pageSize,
    listType,
    record,
    project,
    mode,
    currentFolderPath,
  ]);

  // Sync data when list type or pagination changes
  useEffect(() => {
    switch (listType) {
      case "projects":
        void syncProjects();
        break;
      case "records":
        void syncRecords();
        break;
      case "files":
        void syncFilesList();
        break;
    }
  }, [listType, syncProjects, syncRecords, syncFilesList]);

  // Update target info when record changes
  useEffect(() => {
    setTargetInfo({ record, project, isCreating: recordType === "create" });
  }, [record, project, recordType, setTargetInfo]);

  // Get total count for pagination
  const totalCount = useMemo(() => {
    switch (listType) {
      case "projects":
        return Number(projects.value?.totalSize ?? 0);
      case "records":
        return Number(records.value?.totalSize ?? 0);
      case "files":
        return Number(filesList.value?.totalSize ?? 0);
      default:
        return 0;
    }
  }, [listType, projects.value?.totalSize, records.value?.totalSize, filesList.value?.totalSize]);

  // Handlers
  const handleProjectSelect = useCallback(
    (selectedProject: Project) => {
      resetAllPagination();
      setProject(selectedProject);
      setCurrentFolderPath([]); // 重置文件夹路径

      // In select-files-from-project mode, no need to select record after project selection
      if (mode === "select-files-from-project") {
        setRecord(undefined);
      }
    },
    [resetAllPagination, mode],
  );

  const handleRecordSelect = useCallback(
    (selectedRecord: Record) => {
      resetAllPagination();
      setRecord(selectedRecord);
      setCurrentFolderPath([]); // 重置文件夹路径
    },
    [resetAllPagination],
  );

  const handleFileToggle = useCallback(
    (file: File) => {
      const fileInfo: SelectedFile = {
        file,
        projectDisplayName: project?.displayName ?? "",
        recordDisplayName: record?.title ?? "",
      };

      const existingIndex = files.findIndex((f: SelectedFile) => f.file.name === file.name);
      if (existingIndex >= 0) {
        setFiles(files.filter((_: SelectedFile, index: number) => index !== existingIndex));
      } else {
        setFiles([...files, fileInfo]);
      }
    },
    [project?.displayName, record?.title, files, setFiles],
  );

  const clearProject = useCallback(() => {
    setProject(undefined);
    setRecord(undefined);
    setCurrentFolderPath([]); // 重置文件夹路径
    resetAllPagination();
  }, [resetAllPagination]);

  const clearRecord = useCallback(() => {
    setRecord(undefined);
    setCurrentFolderPath([]); // reset folder path
    resetAllPagination();
  }, [resetAllPagination]);

  const showSearchField = listType !== "records" || recordType !== "create";
  const showPagination = !(listType === "records" && recordType === "create");

  return (
    <Stack flex={1} gap={1} padding={2}>
      <CustomBreadcrumbs
        mode={mode}
        project={project}
        record={record}
        clearProject={clearProject}
        clearRecord={clearRecord}
        setRecordType={setRecordType}
        currentFolderPath={currentFolderPath}
        onNavigateToFolder={setCurrentFolderPath}
        listType={listType}
      />
      {showSearchField && (
        <TextField
          variant="filled"
          value={currentPagination.filter}
          onChange={(event) => {
            currentPagination.setFilter(event.currentTarget.value);
          }}
          size="small"
          placeholder={t("search")}
          slotProps={{
            input: {
              startAdornment: <SearchIcon fontSize="small" />,
              endAdornment: currentPagination.filter && (
                <IconButton
                  edge="end"
                  onClick={() => {
                    currentPagination.setFilter("");
                  }}
                  size="small"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
            },
          }}
        />
      )}
      <Stack flex={1} fullWidth overflow="hidden">
        <Stack fullHeight overflowY="scroll" overflow="hidden">
          {listType === "projects" && (
            <ProjectsList
              projects={projects.value?.userProjects ?? []}
              onProjectSelect={handleProjectSelect}
            />
          )}

          {listType === "records" && recordType === "select" && (
            <RecordsList
              records={records.value?.records ?? []}
              selectedRecord={record}
              onRecordSelect={handleRecordSelect}
            />
          )}

          {listType === "records" && recordType === "create" && (
            <CreateRecordForm
              parent={project?.name ?? ""}
              onCreated={(targetRecord: Record) => {
                setTargetInfo({ record: targetRecord, project, isCreating: true });
              }}
              defaultRecordDisplayName={defaultRecordDisplayName}
              createRecordConfirmText={createRecordConfirmText}
            />
          )}

          {listType === "files" && (
            <SelectFilesList
              files={filesList.value?.files ?? []}
              selectedFiles={files}
              onFileToggle={handleFileToggle}
              checkFileSupportedFunc={checkFileSupportedFunc ?? checkBagFileSupported}
              currentFolderPath={currentFolderPath}
              onNavigateToFolder={setCurrentFolderPath}
            />
          )}
        </Stack>

        {showPagination && (
          <Stack>
            <TablePagination
              component="div"
              count={totalCount}
              page={currentPagination.page}
              onPageChange={(_e, selectedPage) => {
                currentPagination.setPage(selectedPage);
              }}
              rowsPerPageOptions={[20, 50, 100]}
              rowsPerPage={currentPagination.pageSize}
              onRowsPerPageChange={(e) => {
                currentPagination.setPageSize(+e.target.value);
              }}
            />
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
