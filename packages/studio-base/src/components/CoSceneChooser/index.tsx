// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { QueryFields } from "@coscene-io/coscene/queries";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { ListUserProjectsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { ListRecordsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { ListFilesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_pb";
import ClearIcon from "@mui/icons-material/Clear";
import CloseIcon from "@mui/icons-material/Close";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import SearchIcon from "@mui/icons-material/Search";
import {
  Dialog,
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
  Breadcrumbs,
  Link,
  Button,
  Tooltip,
} from "@mui/material";
import { useCallback, useState, useMemo, useEffect } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";
import { useDebounce } from "use-debounce";

import { CreateRecordForm } from "@foxglove/studio-base/components/CoSceneChooser/CreateRecordForm";
import Snow from "@foxglove/studio-base/components/DataSourceDialog/Snow";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  SerializeOption,
  BinaryOperator,
  CosQuery,
  checkBagFileSupported,
} from "@foxglove/studio-base/util/coscene";

type ChooserDialogProps =
  | {
      open: boolean;
      closeDialog: () => void;
      onConfirm: (files: Record) => void;
      backdropAnimation?: boolean;
      type: "record";
      // adapter files type
      checkFileSupportedFunc?: undefined;
      maxFilesNumber?: undefined;
    }
  | {
      open: boolean;
      closeDialog: () => void;
      onConfirm: (files: SelectedFile[]) => void;
      backdropAnimation?: boolean;
      checkFileSupportedFunc?: (file: File) => boolean;
      type: "files";
      maxFilesNumber?: number;
    };

type SelectedFile = {
  file: File;
  projectDisplayName: string;
  recordDisplayName: string;
  isRepeatFile?: boolean;
};

const useStyles = makeStyles()((theme) => ({
  closeButton: {
    position: "absolute",
    right: 0,
    top: 0,
    margin: theme.spacing(3),
  },
  main: {
    padding: theme.spacing(3),
  },
  selecter: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    marginTop: theme.spacing(2),
    height: theme.spacing(65),
  },
  filesListContainer: {
    borderLeft: `1px solid ${theme.palette.divider}`,
  },
}));

function FilesList({
  files,
  setFiles,
}: {
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosPlaylist");
  const { classes } = useStyles();

  return (
    <Stack flex={1} padding={2} className={classes.filesListContainer}>
      <Stack paddingBottom={1}>
        <Typography gutterBottom>
          {t("selectedFilesCount", {
            count: files.length,
          })}
        </Typography>
      </Stack>
      {files.map((file) => {
        return (
          <Stack
            key={file.file.name}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            gap={1}
          >
            <Stack flex={1}>
              <Stack gap={1} direction="row" alignItems="center">
                <InsertDriveFileIcon fontSize="small" />
                {file.file.filename}
              </Stack>
              <Stack direction="row" gap={1}>
                <Typography variant="body2" color="GrayText">
                  {file.projectDisplayName} / {file.recordDisplayName}
                </Typography>
              </Stack>
            </Stack>

            <IconButton
              edge="end"
              onClick={() => {
                const newFiles = new Set(files);
                newFiles.delete(file);
                setFiles(Array.from(newFiles));
              }}
              size="small"
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </Stack>
        );
      })}
    </Stack>
  );
}

const selectUser = (store: UserStore) => store.user;

const CustomBreadcrumbs = ({
  project,
  clearProject,
  record,
  clearRecord,
  type,
  recordType,
  setRecordType,
}: {
  project?: Project;
  clearProject: () => void;
  record?: Record;
  clearRecord: () => void;
  type: "record" | "files";
  recordType: "create" | "select";
  setRecordType: (recordType: "create" | "select") => void;
}) => {
  const { t } = useTranslation("cosGeneral");
  const currentUser = useCurrentUser(selectUser);

  let breadcrumbs: React.JSX.Element[] = [];

  if (!project && !record) {
    breadcrumbs = [
      <Typography key="3" color="text.primary">
        {t("project")}
      </Typography>,
    ];
  }

  if (project && !record) {
    breadcrumbs = [
      <Link
        underline="hover"
        key="2"
        color="inherit"
        onClick={() => {
          clearProject();
        }}
      >
        {t("project")}
      </Link>,
      <Typography key="3" color="text.primary">
        {project.displayName}
      </Typography>,
    ];
  }

  if (project && record) {
    breadcrumbs = [
      <Link
        underline="hover"
        key="2"
        color="inherit"
        onClick={() => {
          clearProject();
          clearRecord();
        }}
      >
        {t("project")}
      </Link>,
      <Link
        underline="hover"
        key="2"
        color="inherit"
        onClick={() => {
          clearRecord();
        }}
      >
        {project.displayName}
      </Link>,
      <Typography key="3" color="text.primary">
        {record.title}
      </Typography>,
    ];
  }

  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
        {breadcrumbs}
      </Breadcrumbs>

      {type === "record" && !project && !record && (
        <Button
          variant="text"
          onClick={() => {
            window.open(currentUser?.targetSite, "_blank");
          }}
        >
          {t("toCreateProject", { ns: "appBar" })}
        </Button>
      )}

      {type === "record" &&
        project &&
        !record &&
        (recordType === "create" ? (
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
        ))}
    </Stack>
  );
};

export function ChooserComponent({
  setTargetRecordName,
  type,
  files,
  setFiles,
  checkFileSupportedFunc,
  defaultRecordType = "select",
  defaultRecordName,
  createRecordConfirmText,
}: {
  setTargetRecordName: (recordName?: Record, recordType?: "create" | "select") => void;
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
  type: "record" | "files";
  checkFileSupportedFunc: (file: File) => boolean;
  defaultRecordType?: "create" | "select";
  defaultRecordName?: string;
  createRecordConfirmText?: string;
}): React.JSX.Element {
  const { t } = useTranslation("cosGeneral");

  const [recordType, setRecordType] = useState<"create" | "select">(defaultRecordType);

  const userInfo = useCurrentUser(selectUser);
  const consoleApi = useConsoleApi();

  const [project, setProject] = useState<Project | undefined>(undefined);
  const [record, setRecord] = useState<Record | undefined>(undefined);

  const [projectsPageSize, setProjectsPageSize] = useState(20);
  const [projectsPage, setProjectsPage] = useState(0);
  const [projectsFilter, setProjectsFilter] = useState("");

  const [debounceProjectsFilter] = useDebounce(projectsFilter, 500);

  const [recordsPageSize, setRecordsPageSize] = useState(20);
  const [recordsPage, setRecordsPage] = useState(0);
  const [recordsFilter, setRecordsFilter] = useState("");
  const [debounceRecordsFilter] = useDebounce(recordsFilter, 500);

  const [filesPageSize, setFilesPageSize] = useState(20);
  const [filesPage, setFilesPage] = useState(0);
  const [filesFilter, setFilesFilter] = useState("");
  const [debounceFilesFilter] = useDebounce(filesFilter, 500);

  useEffect(() => {
    setTargetRecordName(record, "select");
  }, [record, setTargetRecordName]);

  const resetState = () => {
    setProjectsPageSize(20);
    setProjectsPage(0);
    setProjectsFilter("");

    setRecordsPageSize(20);
    setRecordsPage(0);
    setRecordsFilter("");

    setFilesPageSize(20);
    setFilesPage(0);
    setFilesFilter("");
  };

  const listType = useMemo(() => {
    if (project == undefined) {
      return "projects";
    }
    if (record == undefined) {
      return "records";
    }
    if (type === "files") {
      return "files";
    }
    return "records";
  }, [project, record, type]);

  const [filterText, setFilterText] = useMemo(() => {
    if (listType === "projects") {
      return [projectsFilter, setProjectsFilter];
    }
    if (listType === "records") {
      return [recordsFilter, setRecordsFilter];
    }
    return [filesFilter, setFilesFilter];
  }, [filesFilter, listType, projectsFilter, recordsFilter]);

  const [page, setPage] = useMemo(() => {
    if (listType === "projects") {
      return [projectsPage, setProjectsPage];
    }
    if (listType === "records") {
      return [recordsPage, setRecordsPage];
    }
    return [filesPage, setFilesPage];
  }, [filesPage, listType, projectsPage, recordsPage]);

  const [pageSize, setPageSize] = useMemo(() => {
    if (listType === "projects") {
      return [projectsPageSize, setProjectsPageSize];
    }
    if (listType === "records") {
      return [recordsPageSize, setRecordsPageSize];
    }
    return [filesPageSize, setFilesPageSize];
  }, [filesPageSize, listType, projectsPageSize, recordsPageSize]);

  const [projects, syncProjects] = useAsyncFn(async () => {
    const userId = userInfo?.userId;
    const filter = CosQuery.Companion.empty();

    filter.setField(QueryFields.DISPLAY_NAME, [BinaryOperator.HAS], [debounceProjectsFilter]);

    if (userId && listType === "projects") {
      try {
        return await consoleApi.listUserProjects({
          userId,
          filter: filter.toQueryString(new SerializeOption(false)),
          pageSize: projectsPageSize,
          currentPage: projectsPage,
        });
      } catch (error) {
        console.error("error", error);
      }
    }

    return new ListUserProjectsResponse();
  }, [
    consoleApi,
    listType,
    debounceProjectsFilter,
    projectsPage,
    projectsPageSize,
    userInfo?.userId,
  ]);

  const [records, syncRecords] = useAsyncFn(async () => {
    const filter = CosQuery.Companion.empty();

    filter.setField(QueryFields.TITLE, [BinaryOperator.HAS], [debounceRecordsFilter]);

    if (project && listType === "records") {
      return await consoleApi.listRecord({
        projectName: project.name,
        filter: filter.toQueryString(new SerializeOption(false)),
        pageSize: recordsPageSize,
        currentPage: recordsPage,
      });
    }

    return new ListRecordsResponse();
  }, [consoleApi, listType, project, debounceRecordsFilter, recordsPage, recordsPageSize]);

  const [filesList, syncFilesList] = useAsyncFn(async () => {
    const filter = CosQuery.Companion.empty();

    filter.setField(QueryFields.PATH, [BinaryOperator.EQ], [debounceFilesFilter]);
    filter.setField("recursive", [BinaryOperator.EQ], ["true"]);

    if (record && listType === "files") {
      return await consoleApi.listFiles({
        revcordName: record.name,
        pageSize: filesPageSize,
        filter: filter.toQueryString(new SerializeOption(false)),
        currentPage: filesPage,
      });
    }

    return new ListFilesResponse();
  }, [consoleApi, debounceFilesFilter, filesPage, filesPageSize, listType, record]);

  useEffect(() => {
    if (listType === "projects") {
      void syncProjects();
    }
    if (listType === "records") {
      void syncRecords();
    }
    void syncFilesList();
  }, [listType, syncFilesList, syncProjects, syncRecords]);

  const count: number = useMemo(() => {
    if (listType === "projects") {
      return Number(projects.value?.totalSize ?? 0);
    }
    if (listType === "records") {
      return Number(records.value?.totalSize ?? 0);
    }
    return Number(filesList.value?.totalSize ?? 0);
  }, [filesList.value?.totalSize, listType, projects.value?.totalSize, records.value?.totalSize]);

  return (
    <Stack flex={1} gap={1} padding={2}>
      <CustomBreadcrumbs
        type={type}
        project={project}
        record={record}
        clearProject={() => {
          setProject(undefined);
        }}
        clearRecord={() => {
          setRecord(undefined);
        }}
        recordType={recordType}
        setRecordType={setRecordType}
      />

      {(listType !== "records" || recordType !== "create") && (
        <TextField
          variant="filled"
          value={filterText}
          onChange={(event) => {
            setFilterText(event.currentTarget.value);
          }}
          size="small"
          placeholder={t("search")}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" />,
            endAdornment: filterText !== "" && (
              <IconButton
                edge="end"
                onClick={() => {
                  setFilterText("");
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
            <List>
              {projects.value?.userProjects.map((value) => {
                return (
                  <ListItem key={value.name} disablePadding>
                    <ListItemButton
                      role={undefined}
                      onClick={() => {
                        resetState();
                        setProject(value);
                      }}
                      dense
                    >
                      <ListItemText id={value.name} primary={value.displayName} />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
          {listType === "records" &&
            (recordType === "select" ? (
              <List>
                {records.value?.records.map((value) => {
                  return (
                    <ListItem key={value.name} disablePadding>
                      <ListItemButton
                        selected={record?.name === value.name}
                        role={undefined}
                        onClick={() => {
                          resetState();
                          setRecord(value);
                        }}
                        dense
                      >
                        <ListItemText id={value.name} primary={value.title} />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            ) : (
              <CreateRecordForm
                parent={project?.name ?? ""}
                onCreated={(targetRecord: Record) => {
                  setTargetRecordName(targetRecord, "create");
                }}
                defaultRecordName={defaultRecordName}
                createRecordConfirmText={createRecordConfirmText}
              />
            ))}

          {listType === "files" && (
            <List>
              {/* if filename end with '/' then it's a directory */}
              {filesList.value?.files
                .filter((ele) => !ele.name.endsWith("/"))
                .map((value) => {
                  const supportedImport = checkFileSupportedFunc(value);

                  const repeatFile = files.find(
                    (file) => file.file.sha256 === value.sha256 && file.file.name !== value.name,
                  );

                  return (
                    <ListItem key={value.name} disablePadding>
                      <ListItemButton
                        disabled={!supportedImport || repeatFile != undefined}
                        role={undefined}
                        onClick={() => {
                          const fileInfo = {
                            file: value,
                            projectDisplayName: project?.displayName ?? "",
                            recordDisplayName: record?.title ?? "",
                          };
                          const newFiles = new Set(files);
                          let fileExist = false;
                          newFiles.forEach((file) => {
                            if (file.file.name === fileInfo.file.name) {
                              newFiles.delete(file);
                              fileExist = true;
                            }
                          });

                          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                          if (!fileExist) {
                            newFiles.add(fileInfo);
                          }
                          setFiles(Array.from(newFiles));
                        }}
                        dense
                      >
                        <ListItemIcon>
                          <Checkbox
                            edge="start"
                            checked={files.some((file) => file.file.name === value.name)}
                            disabled={!supportedImport}
                            tabIndex={-1}
                            disableRipple
                            inputProps={{ "aria-labelledby": value.filename }}
                          />
                        </ListItemIcon>
                        <ListItemText id={value.name} primary={value.filename.split("/").pop()} />
                      </ListItemButton>
                      {repeatFile != undefined && (
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
          )}
        </Stack>

        {!(listType === "records" && recordType === "create") && (
          <Stack>
            <TablePagination
              component="div"
              count={count}
              page={page}
              onPageChange={(_e, selectedPage) => {
                setPage(selectedPage);
              }}
              rowsPerPageOptions={[20, 50, 100]}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(+e.target.value);
              }}
            />
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

function CoSceneChooser(props: ChooserDialogProps): React.JSX.Element {
  const {
    backdropAnimation,
    open,
    closeDialog,
    onConfirm,
    type,
    checkFileSupportedFunc,
    maxFilesNumber,
  } = props;
  const { classes } = useStyles();
  const [targetRecordName, setTargetRecordName] = useState<Record | undefined>(undefined);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const { t } = useTranslation("cosPlaylist");
  const backdrop = useMemo(() => {
    const now = new Date();
    if (backdropAnimation === false) {
      return;
    } else if (now >= new Date(now.getFullYear(), 11, 25)) {
      return <Snow effect="snow" />;
    } else if (now < new Date(now.getFullYear(), 0, 2)) {
      return <Snow effect="confetti" />;
    }
    return;
  }, [backdropAnimation]);

  useEffect(() => {
    if (maxFilesNumber != undefined && selectedFiles.length > maxFilesNumber) {
      toast.error(t("maxFilesNumber", { maxFilesNumber, ns: "cosEvent" }));
      const newFiles = selectedFiles.slice(0, maxFilesNumber);
      setSelectedFiles(newFiles);
    }
  }, [maxFilesNumber, selectedFiles, t]);

  const onModalClose = useCallback(() => {
    setSelectedFiles([]);
    closeDialog();
  }, [closeDialog]);

  return (
    <Dialog
      data-testid="DataSourceDialog"
      open={open}
      onClose={onModalClose}
      fullWidth
      maxWidth="lg"
      slotProps={{
        backdrop: { children: backdrop },
      }}
      PaperProps={{
        square: false,
        elevation: 4,
      }}
    >
      <IconButton className={classes.closeButton} onClick={onModalClose} edge="end">
        <CloseIcon />
      </IconButton>
      <Stack flexGrow={1} fullHeight justifyContent="space-between" className={classes.main}>
        <Typography variant="h3" gutterBottom>
          {type === "files"
            ? t("selecteFilesFromRecord")
            : t("selectRecordToSaveTheMoment", {
                ns: "cosEvent",
              })}
        </Typography>
        <Stack className={classes.selecter} direction="row">
          <ChooserComponent
            setTargetRecordName={setTargetRecordName}
            files={selectedFiles}
            setFiles={setSelectedFiles}
            type={type}
            checkFileSupportedFunc={checkFileSupportedFunc ?? checkBagFileSupported}
          />
          <FilesList files={selectedFiles} setFiles={setSelectedFiles} />
        </Stack>
        <Stack direction="row" justifyContent="flex-end" paddingTop={2} gap={1}>
          <Button variant="outlined" size="large" color="inherit" onClick={onModalClose}>
            {t("cancel", {
              ns: "cosGeneral",
            })}
          </Button>
          <Button
            onClick={() => {
              if (type === "files") {
                onConfirm(selectedFiles);
                setSelectedFiles([]);
                closeDialog();
                return;
              }
              if (targetRecordName != undefined) {
                onConfirm(targetRecordName);
                closeDialog();
              }
            }}
            variant="contained"
            size="large"
          >
            {t("ok", {
              ns: "cosGeneral",
            })}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

export default CoSceneChooser;
