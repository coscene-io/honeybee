// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { ListUserProjectsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { ListRecordsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { ListFilesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_pb";
import ClearIcon from "@mui/icons-material/Clear";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import SearchIcon from "@mui/icons-material/Search";
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemButton,
  Checkbox,
  TextField,
  Typography,
  IconButton,
  ListItemText,
  TablePagination,
  Tooltip,
} from "@mui/material";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { CreateRecordForm } from "@foxglove/studio-base/components/CoSceneChooser/CreateRecordForm";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { SerializeOption, BinaryOperator, CosQuery } from "@foxglove/studio-base/util/coscene";
import { QueryFields } from "@foxglove/studio-base/util/queries";

import { CustomBreadcrumbs } from "./CustomBreadcrumbs";
import { usePagination } from "./hooks/usePagination";
import { ChooserComponentProps, ListType, RecordType, SelectedFile } from "./types";

const selectUser = (store: UserStore) => store.user;

export function ChooserComponent({
  setTargetInfo,
  type,
  files,
  setFiles,
  checkFileSupportedFunc,
  defaultRecordType = "select",
  defaultRecordName,
  createRecordConfirmText,
}: ChooserComponentProps): React.JSX.Element {
  const { t } = useTranslation("cosGeneral");
  const userInfo = useCurrentUser(selectUser);
  const consoleApi = useConsoleApi();

  const [recordType, setRecordType] = useState<RecordType>(defaultRecordType);
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [record, setRecord] = useState<Record | undefined>(undefined);

  // Pagination hooks for different list types
  const projectsPagination = usePagination(20);
  const recordsPagination = usePagination(20);
  const filesPagination = usePagination(20);

  // Determine current list type
  const listType = useMemo<ListType>(() => {
    if (!project) {
      return "projects";
    }
    if (!record) {
      return "records";
    }
    if (type === "files") {
      return "files";
    }
    return "records";
  }, [project, record, type]);

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
    if (!record || listType !== "files") {
      return new ListFilesResponse();
    }

    const filter = CosQuery.Companion.empty();
    filter.setField(QueryFields.PATH, [BinaryOperator.EQ], [filesPagination.debouncedFilter]);
    filter.setField("recursive", [BinaryOperator.EQ], ["true"]);

    return await consoleApi.listFiles({
      recordName: record.name,
      pageSize: filesPagination.pageSize,
      filter: filter.toQueryString(new SerializeOption(false)),
      currentPage: filesPagination.page,
    });
  }, [
    consoleApi,
    filesPagination.debouncedFilter,
    filesPagination.page,
    filesPagination.pageSize,
    listType,
    record,
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
    setTargetInfo({ record, project, recordType: "select" });
  }, [record, project, setTargetInfo]);

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
    },
    [resetAllPagination],
  );

  const handleRecordSelect = useCallback(
    (selectedRecord: Record) => {
      resetAllPagination();
      setRecord(selectedRecord);
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
    resetAllPagination();
  }, [resetAllPagination]);

  const clearRecord = useCallback(() => {
    setRecord(undefined);
    resetAllPagination();
  }, [resetAllPagination]);

  const showSearchField = listType !== "records" || recordType !== "create";
  const showPagination = !(listType === "records" && recordType === "create");

  return (
    <Stack flex={1} gap={1} padding={2}>
      <CustomBreadcrumbs
        type={type}
        project={project}
        record={record}
        clearProject={clearProject}
        clearRecord={clearRecord}
        recordType={recordType}
        setRecordType={setRecordType}
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
          InputProps={{
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
                setTargetInfo({ record: targetRecord, project, recordType: "create" });
              }}
              defaultRecordName={defaultRecordName}
              createRecordConfirmText={createRecordConfirmText}
            />
          )}

          {listType === "files" && (
            <FilesList
              files={filesList.value?.files.filter((file) => !file.name.endsWith("/")) ?? []}
              selectedFiles={files}
              onFileToggle={handleFileToggle}
              checkFileSupportedFunc={checkFileSupportedFunc}
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

interface FilesListProps {
  files: File[];
  selectedFiles: SelectedFile[];
  onFileToggle: (file: File) => void;
  checkFileSupportedFunc: (file: File) => boolean;
}

const FilesList = ({
  files,
  selectedFiles,
  onFileToggle,
  checkFileSupportedFunc,
}: FilesListProps) => {
  const { t } = useTranslation("cosPlaylist");

  return (
    <List>
      {files.map((file) => {
        const supportedImport = checkFileSupportedFunc(file);
        const isSelected = selectedFiles.some((f) => f.file.name === file.name);
        const repeatFile = selectedFiles.find(
          (f) => f.file.sha256 === file.sha256 && f.file.name !== file.name,
        );

        return (
          <ListItem key={file.name} disablePadding>
            <ListItemButton
              disabled={!supportedImport || repeatFile != undefined}
              role={undefined}
              onClick={() => {
                onFileToggle(file);
              }}
              dense
            >
              <ListItemIcon>
                <Checkbox
                  edge="start"
                  checked={isSelected}
                  disabled={!supportedImport}
                  tabIndex={-1}
                  disableRipple
                  inputProps={{ "aria-labelledby": file.filename }}
                />
              </ListItemIcon>
              <ListItemText id={file.name} primary={file.filename.split("/").pop()} />
            </ListItemButton>
            {repeatFile && (
              <Typography color="error">
                <Tooltip
                  title={t("duplicateFile", {
                    ns: "cosPlaylist",
                    filename: repeatFile.file.filename,
                  })}
                >
                  <HelpOutlineIcon fontSize="small" />
                </Tooltip>
              </Typography>
            )}
          </ListItem>
        );
      })}
    </List>
  );
};
