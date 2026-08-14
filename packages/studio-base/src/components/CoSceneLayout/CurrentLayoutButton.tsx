// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import {
  PersonOutlined as PersonOutlinedIcon,
  BusinessCenterOutlined as BusinessCenterOutlinedIcon,
  SpaceDashboardOutlined as SpaceDashboardOutlinedIcon,
  AutoAwesomeOutlined as AutoAwesomeOutlinedIcon,
} from "@mui/icons-material";
import { Button, ButtonBase } from "@mui/material";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { APP_BAR_HEIGHT } from "@foxglove/studio-base/components/AppBar/constants";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { LayoutID, LayoutState } from "@foxglove/studio-base/context/CurrentLayoutContext";
import {
  Layout,
  layoutIsProject,
  layoutIsRead,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()((theme) => ({
  textTruncate: {
    overflow: "hidden",
    color: theme.palette.text.primary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  subIcon: {
    color: theme.palette.text.secondary,
    flexShrink: 0,
  },
  layoutButton: {
    font: "inherit",
    height: APP_BAR_HEIGHT - 2,
    fontSize: theme.typography.body2.fontSize,
    justifyContent: "space-between",
    maxWidth: "240px",
    padding: theme.spacing(1.125, 1.5),
    gap: theme.spacing(0.5),
    borderRadius: 0,
    WebkitAppRegion: "no-drag", // make button clickable for desktop app

    ":hover": {
      backgroundColor: theme.palette.background.hover,
    },
    "&.Mui-selected": {
      backgroundColor: theme.palette.background.hover,
    },
  },
  button: {
    flexShrink: 0,
    minWidth: "auto",
    padding: theme.spacing(0.5, 1),
    WebkitAppRegion: "no-drag", // make button clickable for desktop app
  },
  leftContent: {
    overflow: "hidden",
    minWidth: 0,
    flex: 1,
  },
}));

interface CurrentLayoutButtonProps {
  currentLayoutId?: LayoutID;
  selectedLayout?: LayoutState["selectedLayout"];
  loading?: boolean;
  onClick: () => void;
  onOverwriteLayout: (layout: Layout) => void;
  onSaveRecommendedLayout: () => void;
  onRevertLayout: (layout: Layout) => void;
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    allLayouts: Layout[];
  };
}

export function CurrentLayoutButton({
  currentLayoutId,
  selectedLayout,
  layouts,
  loading,
  onClick,
  onOverwriteLayout,
  onSaveRecommendedLayout,
  onRevertLayout,
}: CurrentLayoutButtonProps): React.JSX.Element {
  const { t } = useTranslation("layout");
  const { classes } = useStyles();

  const currentLayout = useMemo(() => {
    return [...(layouts?.allLayouts ?? [])].find((layout) => layout.id === currentLayoutId);
  }, [layouts, currentLayoutId]);

  const deletedOnServer = currentLayout?.syncInfo?.status === "remotely-deleted";
  const isRecommended = selectedLayout?.source === "recommended";
  const hasModifications = !isRecommended && currentLayout?.working != undefined;
  const isRead = !!currentLayout && layoutIsRead(currentLayout);

  const getDisplayText = (): string => {
    if (loading === true) {
      return t("loading");
    }

    if (isRecommended) {
      return selectedLayout.name ?? t("recommendedLayout");
    }

    if (!currentLayout) {
      return t("noLayouts");
    }

    return currentLayout.name;
  };

  const getSubIcon = () => {
    if (isRecommended) {
      return <AutoAwesomeOutlinedIcon fontSize="small" />;
    }
    if (currentLayout?.permission === "PERSONAL_WRITE") {
      return <PersonOutlinedIcon fontSize="small" />;
    }
    if (currentLayout && layoutIsProject(currentLayout)) {
      return <BusinessCenterOutlinedIcon fontSize="small" />;
    }
    return <SpaceDashboardOutlinedIcon fontSize="small" />;
  };

  const handleOverwrite = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (!currentLayout) {
        return;
      }

      onOverwriteLayout(currentLayout);
    },
    [currentLayout, onOverwriteLayout],
  );

  const handleRevert = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (!currentLayout) {
        return;
      }

      onRevertLayout(currentLayout);
    },
    [currentLayout, onRevertLayout],
  );

  const handleSaveRecommended = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onSaveRecommendedLayout();
    },
    [onSaveRecommendedLayout],
  );

  const consoleApi = useConsoleApi();
  const isProject = currentLayout ? layoutIsProject(currentLayout) : false;
  const canUpdate = isProject ? consoleApi.updateProjectLayout.permission() : true;

  const buttons = [
    {
      key: "saveRecommended",
      text: t("saveAPersonalCopy"),
      onClick: handleSaveRecommended,
      disabled: selectedLayout?.data == undefined,
      visible: isRecommended,
    },
    {
      key: "saveChanges",
      text: t("save"),
      onClick: handleOverwrite,
      disabled: (deletedOnServer && isProject) || isRead || !canUpdate,
      visible: hasModifications,
    },
    {
      key: "revert",
      text: t("revert"),
      onClick: handleRevert,
      disabled: deletedOnServer,
      visible: hasModifications,
    },
  ].filter((button) => button.visible);

  return (
    <ButtonBase
      component="div"
      className={classes.layoutButton}
      aria-haspopup="true"
      onClick={onClick}
      disabled={loading === true || selectedLayout?.loading === true}
    >
      <div className={classes.leftContent}>
        <Stack direction="row" alignItems="center" gap={1}>
          <div className={classes.subIcon}>{getSubIcon()}</div>
          <div className={classes.textTruncate} title={getDisplayText()}>
            {getDisplayText()}
          </div>
        </Stack>
      </div>
      {buttons.map((button) => (
        <Button
          key={button.key}
          size="small"
          onClick={button.onClick}
          disabled={button.disabled}
          variant="outlined"
          className={classes.button}
        >
          {button.text}
        </Button>
      ))}
    </ButtonBase>
  );
}
