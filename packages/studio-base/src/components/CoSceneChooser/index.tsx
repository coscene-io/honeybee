// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { QueryFields } from "@coscene-io/coscene/queries";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { ListUserProjectsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/file_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { ListFilesResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/file_pb";
import { ListRecordsResponse } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
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
  CircularProgress,
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

import Snow from "@foxglove/studio-base/components/DataSourceDialog/Snow";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { SerializeOption, BinaryOperator, CosQuery } from "@foxglove/studio-base/util/coscene";

const SupportedFileTypes = [
  "text/plain",
  "image/png",
  "image/x-portable-bitmap",
  "image/x-portable-graymap",
  "image/x-portable-pixmap",
  "application/vnd.ros1.bag",
  "application/vnd.cyber.rt",
  "application/vnd.mcap",
];

const checkBagFileSupported = (file: File) => {
  return !!(file.mediaStorageUri && SupportedFileTypes.includes(file.mediaType));
};

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
  paper: {
    maxWidth: `calc(min(${theme.breakpoints.values.md}px, 100% - ${theme.spacing(4)}))`,
  },
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
    height: theme.spacing(73),
  },
  chooserContainer: {
    borderRight: `1px solid ${theme.palette.divider}`,
  },
}));

function FilesList({
  files,
  setFiles,
}: {
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
}): JSX.Element {
  const { t } = useTranslation("cosPlaylist");

  return (
    <Stack flex={1} padding={2}>
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

const CustomBreadcrumbs = ({
  project,
  clearProject,
  record,
  clearRecord,
}: {
  project?: Project;
  clearProject: () => void;
  record?: Record;
  clearRecord: () => void;
}) => {
  const { t } = useTranslation("cosGeneral");
  let breadcrumbs: JSX.Element[] = [];

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
    <Stack>
      <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
        {breadcrumbs}
      </Breadcrumbs>
    </Stack>
  );
};

function ChooserComponent({
  setTargetRecordName,
  type,
  files,
  setFiles,
  checkFileSupportedFunc,
}: {
  setTargetRecordName: (recordName?: Record) => void;
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
  type: "record" | "files";
  checkFileSupportedFunc: (file: File) => boolean;
}) {
  const { classes } = useStyles();
  const { t } = useTranslation("cosGeneral");

  const userInfo = useCurrentUser();
  const consoleApi = useConsoleApi();

  const [project, setProject] = useState<Project | undefined>(undefined);
  const [record, setRecord] = useState<Record | undefined>(undefined);

  const [projectsPageSize, setProjectsPageSize] = useState(20);
  const [projectsPage, setProjectsPage] = useState(0);
  const [projectsFilter, setProjectsFilter] = useState("");

  const [recordsPageSize, setRecordsPageSize] = useState(20);
  const [recordsPage, setRecordsPage] = useState(0);
  const [recordsFilter, setRecordsFilter] = useState("");

  const [filesPageSize, setFilesPageSize] = useState(20);
  const [filesPage, setFilesPage] = useState(0);
  const [filesFilter, setFilesFilter] = useState("");

  useEffect(() => {
    setTargetRecordName(record);
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
    return "";
  }, [project, record, type]);

  const [filterText, setFilterText] = useMemo(() => {
    if (listType === "projects") {
      return [projectsFilter, setProjectsFilter];
    }
    if (listType === "records") {
      return [recordsFilter, setRecordsFilter];
    }
    if (listType === "files") {
      return [filesFilter, setFilesFilter];
    }
    return ["", () => {}];
  }, [filesFilter, listType, projectsFilter, recordsFilter]);

  const [page, setPage] = useMemo(() => {
    if (listType === "projects") {
      return [projectsPage, setProjectsPage];
    }
    if (listType === "records") {
      return [recordsPage, setRecordsPage];
    }
    if (listType === "files") {
      return [filesPage, setFilesPage];
    }
    return [1, () => {}];
  }, [filesPage, listType, projectsPage, recordsPage]);

  const [pageSize, setPageSize] = useMemo(() => {
    if (listType === "projects") {
      return [projectsPageSize, setProjectsPageSize];
    }
    if (listType === "records") {
      return [recordsPageSize, setRecordsPageSize];
    }
    if (listType === "files") {
      return [filesPageSize, setFilesPageSize];
    }
    return [10, () => {}];
  }, [filesPageSize, listType, projectsPageSize, recordsPageSize]);

  const [projects, syncProjects] = useAsyncFn(async () => {
    const userId = userInfo?.userId;
    const filter = CosQuery.Companion.empty();

    filter.setField(QueryFields.DISPLAY_NAME, [BinaryOperator.HAS], [projectsFilter]);

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
  }, [consoleApi, listType, projectsFilter, projectsPage, projectsPageSize, userInfo?.userId]);

  const [records, syncRecords] = useAsyncFn(async () => {
    const filter = CosQuery.Companion.empty();

    filter.setField(QueryFields.TITLE, [BinaryOperator.HAS], [recordsFilter]);

    if (project && listType === "records") {
      return await consoleApi.listRecord({
        projectName: project.name,
        filter: filter.toQueryString(new SerializeOption(false)),
        pageSize: recordsPageSize,
        currentPage: recordsPage,
      });
    }

    return new ListRecordsResponse();
  }, [consoleApi, listType, project, recordsFilter, recordsPage, recordsPageSize]);

  const [filesList, syncFilesList] = useAsyncFn(async () => {
    if (record && listType === "files") {
      return await consoleApi.listFiles({
        revisionName: record.head?.name ?? "",
        pageSize: filesPageSize,
        filter: filesFilter,
        currentPage: filesPage,
      });
    }

    return new ListFilesResponse();
  }, [consoleApi, filesFilter, filesPage, filesPageSize, listType, record]);

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
    if (listType === "files") {
      return Number(filesList.value?.totalSize ?? 0);
    }
    return 0;
  }, [filesList.value?.totalSize, listType, projects.value?.totalSize, records.value?.totalSize]);

  return (
    <Stack flex={1} gap={1} padding={2} className={classes.chooserContainer}>
      <CustomBreadcrumbs
        project={project}
        record={record}
        clearProject={() => {
          setProject(undefined);
        }}
        clearRecord={() => {
          setRecord(undefined);
        }}
      />
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

      {projects.loading || records.loading || filesList.loading ? (
        <Stack flex={1} fullHeight fullWidth justifyContent="center" alignItems="center">
          <CircularProgress />
        </Stack>
      ) : (
        <Stack flex={1} overflowY="scroll" fullWidth>
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
          {listType === "records" && (
            <List>
              {records.value?.records.map((value) => {
                return (
                  <ListItem key={value.name} disablePadding>
                    <ListItemButton
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
          )}
          {listType === "files" && (
            <List>
              {filesList.value?.files.map((value) => {
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
      )}

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
  );
}

function CoSceneChooser(props: ChooserDialogProps): JSX.Element {
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
      BackdropProps={{ children: backdrop }}
      PaperProps={{
        square: false,
        elevation: 4,
        className: classes.paper,
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
