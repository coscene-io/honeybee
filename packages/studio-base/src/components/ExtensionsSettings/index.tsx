// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import ComputerIcon from "@mui/icons-material/Computer";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import LinkIcon from "@mui/icons-material/Link";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@foxglove/studio";
import CoSceneChooser from "@foxglove/studio-base/components/CoSceneChooser";
import type { SelectedFile } from "@foxglove/studio-base/components/CoSceneChooser/types";
import { ExtensionDetails } from "@foxglove/studio-base/components/ExtensionDetails";
import Stack from "@foxglove/studio-base/components/Stack";
import {
  FOXGLOVE_EXTENSION_SUFFIX,
  COSCENE_EXTENSION_SUFFIX,
} from "@foxglove/studio-base/constants/extensionKeys";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { ExtensionMarketplaceDetail } from "@foxglove/studio-base/context/ExtensionMarketplaceContext";
import { useS3FileService } from "@foxglove/studio-base/context/S3FileServiceContext";
import { useHandleFiles } from "@foxglove/studio-base/hooks/useHandleFiles";

const useStyles = makeStyles()((theme) => ({
  listItemButton: {
    "&:hover": { color: theme.palette.primary.main },
  },
  menuItem: {
    display: "flex",
    gap: theme.spacing(1),
    alignItems: "center",
  },
  menuIcon: {
    minWidth: "auto",
    color: theme.palette.text.secondary,
  },
}));

function displayNameForNamespace(
  namespace: string,
  t: ReturnType<typeof useTranslation<"extensions">>["t"],
): string {
  switch (namespace) {
    case "org":
      return t("organization");
    case "local":
      return t("local");
    default:
      return namespace;
  }
}

function ExtensionListEntry(props: {
  entry: Immutable<ExtensionMarketplaceDetail>;
  onClick: () => void;
}): React.JSX.Element {
  const {
    entry: { id, description, name, publisher, version },
    onClick,
  } = props;
  const { classes } = useStyles();
  return (
    <ListItem disablePadding key={id}>
      <ListItemButton className={classes.listItemButton} onClick={onClick}>
        <ListItemText
          disableTypography
          primary={
            <Stack direction="row" alignItems="baseline" gap={0.5}>
              <Typography variant="subtitle2" fontWeight={600}>
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {version}
              </Typography>
            </Stack>
          }
          secondary={
            <Stack gap={0.5}>
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
              <Typography color="text.primary" variant="body2">
                {publisher}
              </Typography>
            </Stack>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

// Extension file accept types for file input
const EXTENSION_FILE_ACCEPT = [FOXGLOVE_EXTENSION_SUFFIX, COSCENE_EXTENSION_SUFFIX].join(",");

const selectProject = (store: CoreDataStore) => store.project;

/**
 * Parse file path to extract project and file key
 * @param filePath File path (project-name/files/...)
 * @returns project and fileKey
 */
function parseFilePath(filePath: string): { project: string; fileKey: string } {
  const project = filePath.split("/files/")[0] ?? "";
  const fileKey = `project${filePath.split("project").pop()}`;
  return { project, fileKey };
}

export function ExtensionsSettingsMore(): React.ReactElement {
  const { classes } = useStyles();
  const { t } = useTranslation("extensions");
  const [menuAnchorEl, setMenuAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [projectFileDialogOpen, setProjectFileDialogOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(ReactNull);
  const { openFiles } = useHandleFiles();
  const { enqueueSnackbar } = useSnackbar();
  const s3FileService = useS3FileService();
  const project = useCoreData(selectProject);

  const downloadExtension = useExtensionCatalog((state) => state.downloadExtension);
  const installExtension = useExtensionCatalog((state) => state.installExtension);

  const menuOpen = Boolean(menuAnchorEl);

  const handleMenuClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setMenuAnchorEl(event.currentTarget);
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenuAnchorEl(undefined);
  }, []);

  // Handle file input change
  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files) {
        void openFiles(Array.from(files));
      }
      // Reset file input value to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [openFiles],
  );

  // Trigger file input click for local installation
  const handleInstallFromLocal = useCallback(() => {
    fileInputRef.current?.click();
    handleMenuClose();
  }, [handleMenuClose]);

  // Handle URL dialog open
  const handleOpenUrlDialog = useCallback(() => {
    setUrlDialogOpen(true);
    handleMenuClose();
  }, [handleMenuClose]);

  // Handle URL dialog close
  const handleCloseUrlDialog = useCallback(() => {
    setUrlDialogOpen(false);
    setUrlInput("");
  }, []);

  // Handle project file dialog open
  const handleOpenProjectFileDialog = useCallback(() => {
    setProjectFileDialogOpen(true);
    handleMenuClose();
  }, [handleMenuClose]);

  // Handle project file dialog close
  const handleCloseProjectFileDialog = useCallback(() => {
    setProjectFileDialogOpen(false);
  }, []);

  // Handle install from project resources
  const handleInstallFromProject = useCallback(
    async (files: SelectedFile[]) => {
      if (files.length === 0) {
        return;
      }

      const selectedFile = files[0];
      if (!selectedFile?.file.name) {
        enqueueSnackbar(t("noValidExtensionFile"), { variant: "error" });
        return;
      }

      const fileName = selectedFile.file.name;

      setInstalling(true);
      try {
        // Parse file path to extract project and file key
        // file.name format: project-name/files/...
        const { project: projectName, fileKey } = parseFilePath(fileName);

        if (!projectName || !fileKey) {
          throw new Error(t("cannotParseFilePath"));
        }

        // Get file data from S3
        const result = await s3FileService.getObject(projectName, fileKey);
        const extensionData = result.data;

        // Install extension
        await installExtension("local", extensionData);
        enqueueSnackbar(t("extensionInstallSuccess"), { variant: "success" });
        handleCloseProjectFileDialog();
      } catch (err) {
        enqueueSnackbar(
          `${t("extensionInstallFailed")}: ${err instanceof Error ? err.message : String(err)}`,
          {
            variant: "error",
          },
        );
      } finally {
        setInstalling(false);
      }
    },
    [s3FileService, installExtension, enqueueSnackbar, handleCloseProjectFileDialog, t],
  );

  // Handle install from URL
  const handleInstallFromUrl = useCallback(async () => {
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      enqueueSnackbar(t("pleaseEnterValidUrl"), { variant: "error" });
      return;
    }

    // Validate URL format
    try {
      new URL(trimmedUrl);
    } catch {
      enqueueSnackbar(t("invalidUrlFormat"), { variant: "error" });
      return;
    }

    setInstalling(true);
    try {
      const data = await downloadExtension(trimmedUrl);
      await installExtension("local", data);
      enqueueSnackbar(t("extensionInstallSuccess"), { variant: "success" });
      handleCloseUrlDialog();
    } catch (err) {
      enqueueSnackbar(
        `${t("extensionInstallFailed")}: ${err instanceof Error ? err.message : String(err)}`,
        {
          variant: "error",
        },
      );
    } finally {
      setInstalling(false);
    }
  }, [urlInput, downloadExtension, installExtension, enqueueSnackbar, handleCloseUrlDialog, t]);

  const menuItems = useMemo(
    () => [
      {
        key: "install-local",
        text: t("installFromLocal"),
        icon: <ComputerIcon fontSize="small" />,
        onClick: handleInstallFromLocal,
      },
      {
        key: "install-project",
        text: t("installFromProject"),
        icon: <FolderOpenIcon fontSize="small" />,
        onClick: handleOpenProjectFileDialog,
      },
      {
        key: "install-url",
        text: t("installFromUrl"),
        icon: <LinkIcon fontSize="small" />,
        onClick: handleOpenUrlDialog,
      },
    ],
    [handleInstallFromLocal, handleOpenUrlDialog, handleOpenProjectFileDialog, t],
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={EXTENSION_FILE_ACCEPT}
        style={{ display: "none" }}
        onChange={handleFileInputChange}
        multiple
      />
      <IconButton
        id="extensions-menu-button"
        aria-controls={menuOpen ? "extensions-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={menuOpen ? "true" : undefined}
        onClick={handleMenuClick}
        size="small"
        title={t("installExtension")}
      >
        <AddIcon />
      </IconButton>
      <Menu
        id="extensions-menu"
        anchorEl={menuAnchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        aria-labelledby="extensions-menu-button"
        slotProps={{
          list: {
            dense: true,
          },
        }}
      >
        {menuItems.map((item) => (
          <MenuItem
            key={item.key}
            onClick={(event) => {
              event.stopPropagation();
              item.onClick();
            }}
            className={classes.menuItem}
          >
            <ListItemIcon className={classes.menuIcon}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.text} />
          </MenuItem>
        ))}
      </Menu>

      {/* URL Install Dialog */}
      <Dialog
        open={urlDialogOpen}
        onClose={(_event, reason) => {
          if (reason === "backdropClick" || installing) {
            return;
          }
          handleCloseUrlDialog();
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("installExtensionFromUrl")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={t("extensionUrl")}
            type="url"
            fullWidth
            variant="outlined"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
            }}
            placeholder={t("extensionUrlPlaceholder")}
            disabled={installing}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !installing) {
                void handleInstallFromUrl();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseUrlDialog} disabled={installing}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => {
              void handleInstallFromUrl();
            }}
            variant="contained"
            disabled={installing || !urlInput.trim()}
            startIcon={installing ? <CircularProgress size={16} /> : undefined}
          >
            {installing ? t("installing") : t("install")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Project File Install Dialog */}
      <CoSceneChooser
        open={projectFileDialogOpen}
        closeDialog={handleCloseProjectFileDialog}
        onConfirm={handleInstallFromProject}
        mode="select-files-from-project"
        maxFilesNumber={1}
        checkFileSupportedFunc={(file) => {
          return (
            file.name.endsWith(FOXGLOVE_EXTENSION_SUFFIX) ||
            file.name.endsWith(COSCENE_EXTENSION_SUFFIX)
          );
        }}
        defaultProject={project.value}
      />
    </>
  );
}

export default function ExtensionsSettings(): React.ReactElement {
  const { t } = useTranslation("extensions");
  const [focusedExtension, setFocusedExtension] = useState<
    | {
        installed: boolean;
        entry: Immutable<ExtensionMarketplaceDetail>;
      }
    | undefined
  >(undefined);
  const installed = useExtensionCatalog((state) => state.installedExtensions);
  const installedEntries = useMemo(
    () =>
      (installed ?? []).map((entry) => {
        return {
          id: entry.id,
          installed: true,
          name: entry.displayName,
          displayName: entry.displayName,
          description: entry.description,
          publisher: entry.publisher,
          homepage: entry.homepage,
          license: entry.license,
          version: entry.version,
          keywords: entry.keywords,
          namespace: entry.namespace,
          qualifiedName: entry.qualifiedName,
        };
      }),
    [installed],
  );

  const namespacedEntries = useMemo(
    () => _.groupBy(installedEntries, (entry) => entry.namespace),
    [installedEntries],
  );

  if (focusedExtension != undefined) {
    return (
      <ExtensionDetails
        installed={focusedExtension.installed}
        extension={focusedExtension.entry}
        onClose={() => {
          setFocusedExtension(undefined);
        }}
      />
    );
  }

  return (
    <Stack gap={1}>
      {!_.isEmpty(namespacedEntries) ? (
        Object.entries(namespacedEntries).map(([namespace, entries]) => (
          <List key={namespace}>
            <Stack paddingY={0.25} paddingX={2}>
              <Typography component="li" variant="overline" color="text.secondary">
                {displayNameForNamespace(namespace, t)}
              </Typography>
            </Stack>
            {entries.map((entry) => (
              <ExtensionListEntry
                key={entry.id}
                entry={entry}
                onClick={() => {
                  setFocusedExtension({ installed: true, entry });
                }}
              />
            ))}
          </List>
        ))
      ) : (
        <List>
          <ListItem>
            <ListItemText primary={t("noInstalledExtensions")} />
          </ListItem>
        </List>
      )}
    </Stack>
  );
}
