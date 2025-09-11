// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, ButtonBase, Typography } from "@mui/material";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { APP_BAR_HEIGHT } from "@foxglove/studio-base/components/AppBar/constants";
import Stack from "@foxglove/studio-base/components/Stack";
import TextMiddleTruncate from "@foxglove/studio-base/components/TextMiddleTruncate";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()((theme) => ({
  textTruncate: {
    maxWidth: "18vw",
    overflow: "hidden",
    color: theme.palette.text.primary,
  },
  subheader: {
    fontSize: 8,
    opacity: 0.6,
    color: theme.palette.text.secondary,
  },
  layoutButton: {
    font: "inherit",
    height: APP_BAR_HEIGHT - 2,
    fontSize: theme.typography.body2.fontSize,
    justifyContent: "space-between",
    minWidth: 120,
    padding: theme.spacing(1.125, 1.5),
    gap: theme.spacing(1.5),
    borderRadius: 0,

    ":hover": {
      backgroundColor: theme.palette.background.hover,
    },
    "&.Mui-selected": {
      backgroundColor: theme.palette.background.hover,
    },
  },
}));

interface LayoutButtonProps {
  currentLayoutId?: LayoutID;
  supportsEditProject: boolean;
  loading?: boolean;
  onClick: () => void;
  onOverwriteLayout: (layout: Layout) => void;
  onRevertLayout: (layout: Layout) => void;
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    personalLayouts: Layout[];
    projectLayouts: Layout[];
  };
}

export function LayoutButton({
  currentLayoutId,
  layouts,
  supportsEditProject,
  loading,
  onClick,
  onOverwriteLayout,
  onRevertLayout,
}: LayoutButtonProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();

  const currentLayout = useMemo(() => {
    return [...(layouts?.personalLayouts ?? []), ...(layouts?.projectLayouts ?? [])].find(
      (layout) => layout.id === currentLayoutId,
    );
  }, [layouts, currentLayoutId]);

  const deletedOnServer = currentLayout?.syncInfo?.status === "remotely-deleted";
  const hasModifications = currentLayout?.working != undefined;
  const supportsEdit =
    !!currentLayout && (supportsEditProject || currentLayout.permission === "CREATOR_WRITE");

  const getDisplayText = (): string => {
    if (loading === true) {
      return t("loading");
    }

    if (!currentLayout) {
      return t("noLayouts");
    }

    return currentLayout.name;
  };

  const getSubheader = () => {
    if (loading === true) {
      return undefined;
    }
    if (currentLayout?.permission === "CREATOR_WRITE") {
      return t("personalLayout");
    }
    if (currentLayout?.permission === "ORG_WRITE" || currentLayout?.permission === "ORG_READ") {
      return t("projectLayout");
    }
    return t("layout");
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

  const buttons = [
    {
      key: "saveChanges",
      text: t("saveChanges"),
      onClick: handleOverwrite,
      disabled: deletedOnServer || !supportsEdit,
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
      className={classes.layoutButton}
      aria-haspopup="true"
      onClick={onClick}
      disabled={loading}
    >
      <Stack alignItems="flex-start">
        {getSubheader() && (
          <Typography variant="overline" className={classes.subheader}>
            {getSubheader()}
          </Typography>
        )}
        <div className={classes.textTruncate}>
          <TextMiddleTruncate text={getDisplayText()} />
        </div>
      </Stack>
      {buttons.map((button) => (
        <Button key={button.key} onClick={button.onClick} disabled={button.disabled}>
          {button.text}
        </Button>
      ))}
    </ButtonBase>
  );
}
