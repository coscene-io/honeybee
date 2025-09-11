// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ErrorIcon from "@mui/icons-material/Error";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Menu,
  MenuItem,
  SvgIcon,
  Divider,
  Typography,
  TextField,
  // eslint-disable-next-line
  styled as muiStyled,
  Stack,
} from "@mui/material";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  MouseEvent,
  useEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { useMountedState } from "react-use";

import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { Layout, layoutIsProject } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const StyledListItem = muiStyled(ListItem, {
  shouldForwardProp: (prop) =>
    prop !== "hasModifications" && prop !== "deletedOnServer" && prop !== "editingName",
})<{ editingName: boolean; hasModifications: boolean; deletedOnServer: boolean }>(
  ({ editingName, hasModifications, deletedOnServer, theme }) => ({
    ".MuiListItemSecondaryAction-root": {
      right: theme.spacing(0.25),
    },
    ".MuiListItemButton-root": {
      maxWidth: "100%",
    },
    "@media (pointer: fine)": {
      ".MuiListItemButton-root": {
        paddingRight: theme.spacing(4.5),
      },
      ".MuiListItemSecondaryAction-root": {
        visibility: !hasModifications && !deletedOnServer && "hidden",
      },
      "&:hover .MuiListItemSecondaryAction-root": {
        visibility: "visible",
      },
    },
    ...(editingName && {
      ".MuiListItemButton-root": {
        paddingTop: theme.spacing(0.5),
        paddingBottom: theme.spacing(0.5),
        paddingLeft: theme.spacing(1),
      },
      ".MuiListItemText-root": {
        margin: 0,
      },
    }),
  }),
);

const StyledMenuItem = muiStyled(MenuItem, {
  shouldForwardProp: (prop) => prop !== "debug",
})<{ debug?: boolean }>(({ theme, debug = false }) => ({
  position: "relative",

  ...(debug && {
    "&:before": {
      content: "''",
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
      backgroundColor: theme.palette.warning.main,
      backgroundImage: `repeating-linear-gradient(${[
        "-35deg",
        "transparent",
        "transparent 6px",
        `${theme.palette.common.black} 6px`,
        `${theme.palette.common.black} 12px`,
      ].join(",")})`,
    },
  }),
}));

export type LayoutActionMenuItem =
  | {
      type: "item";
      text: string;
      secondaryText?: string;
      key: string;
      onClick?: (event: React.MouseEvent<HTMLLIElement>) => void;
      disabled?: boolean;
      debug?: boolean;
      "data-testid"?: string;
    }
  | {
      type: "divider";
      key: string;
      debug?: boolean;
    }
  | {
      type: "header";
      key: string;
      text: string;
      debug?: boolean;
    };

export default React.memo(function LayoutRow({
  layout,
  anySelectedModifiedLayouts,
  multiSelectedIds,
  selected,
  searchQuery,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
  onShare,
  onExport,
  onOverwrite,
  onRevert,
  onMakePersonalCopy,
}: {
  layout: Layout;
  anySelectedModifiedLayouts: boolean;
  multiSelectedIds: readonly string[];
  selected: boolean;
  searchQuery: string;
  onSelect: (item: Layout, params?: { selectedViaClick?: boolean; event?: MouseEvent }) => void;
  onRename?: (item: Layout, newName: string) => void;
  onDuplicate: (item: Layout) => void;
  onDelete?: (item: Layout) => void;
  onShare: (item: Layout) => void;
  onExport: (item: Layout) => void;
  onOverwrite?: (item: Layout) => void;
  onRevert?: (item: Layout) => void;
  onMakePersonalCopy: (item: Layout) => void;
}): React.JSX.Element {
  const isMounted = useMountedState();
  const confirm = useConfirm();
  const layoutManager = useLayoutManager();
  const { t } = useTranslation("cosLayout");
  // const currentUserRole = useCurrentUser(selectUserRole);

  const [editingName, setEditingName] = useState(false);
  const [nameFieldValue, setNameFieldValue] = useState("");
  const [isOnline, setIsOnline] = useState(layoutManager.isOnline);
  const [contextMenuTarget, setContextMenuTarget] = useState<
    | { type: "position"; mouseX: number; mouseY: number; element?: undefined }
    | { type: "element"; element: Element }
    | undefined
  >(undefined);

  const deletedOnServer = layout.syncInfo?.status === "remotely-deleted";
  const hasModifications = layout.working != undefined && onOverwrite != undefined;
  const multiSelection = multiSelectedIds.length > 1;

  // const project = useCoreData(selectProject);
  // const record = useCoreData(selectRecord);

  useLayoutEffect(() => {
    const onlineListener = () => {
      setIsOnline(layoutManager.isOnline);
    };
    onlineListener();
    layoutManager.on("onlinechange", onlineListener);
    return () => {
      layoutManager.off("onlinechange", onlineListener);
    };
  }, [layoutManager]);

  const overwriteAction = useCallback(() => {
    if (onOverwrite == undefined) {
      throw new Error("onOverwrite is not defined");
    }
    onOverwrite(layout);
  }, [layout, onOverwrite]);

  const confirmRevert = useCallback(async () => {
    if (onRevert == undefined) {
      throw new Error("onRevert is not defined");
    }
    const response = await confirm({
      title: multiSelection
        ? t("revertLayouts")
        : t("revertTargetLayout", {
            layoutName: layout.name,
          }),
      prompt: t("revertLayoutsPrompt"),
      ok: t("revertLayoutsConfim"),
      cancel: t("cancel", { ns: "cosGeneral" }),
      variant: "danger",
    });
    if (response !== "ok") {
      return;
    }

    onRevert(layout);
  }, [confirm, layout, multiSelection, t, onRevert]);

  const makePersonalCopyAction = useCallback(() => {
    onMakePersonalCopy(layout);
  }, [layout, onMakePersonalCopy]);

  const renameAction = useCallback(() => {
    setNameFieldValue(layout.name);
    setEditingName(true);
  }, [layout]);

  const onClick = useCallback(
    (event: MouseEvent) => {
      onSelect(layout, { selectedViaClick: true, event });
    },
    [layout, onSelect],
  );

  const duplicateAction = useCallback(() => {
    onDuplicate(layout);
  }, [layout, onDuplicate]);

  const shareAction = useCallback(() => {
    onShare(layout);
  }, [layout, onShare]);

  const exportAction = useCallback(() => {
    onExport(layout);
  }, [layout, onExport]);

  const onSubmit = useCallback(
    (event: React.FormEvent) => {
      if (onRename == undefined) {
        throw new Error("onRename is not defined");
      }
      event.preventDefault();
      if (!editingName) {
        return;
      }
      const newName = nameFieldValue;
      if (newName && newName !== layout.name) {
        onRename(layout, newName);
      }
      setEditingName(false);
    },
    [editingName, layout, nameFieldValue, onRename],
  );

  const onTextFieldKeyDown = useCallback((event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      setEditingName(false);
    }
  }, []);

  const onBlur = useCallback(
    (event: React.FocusEvent) => {
      onSubmit(event);
    },
    [onSubmit],
  );

  const nameInputRef = useRef<HTMLInputElement>(ReactNull);

  const confirmDelete = useCallback(() => {
    if (onDelete == undefined) {
      throw new Error("onDelete is not defined");
    }
    const layoutWarning =
      !multiSelection && layoutIsProject(layout) ? t("deleteLayoutsWarning") : "";
    const prompt = t("deleteLayoutsPrompt", { layoutWarning });
    const title = multiSelection
      ? t("deleteSelectedLayoutsTitle")
      : t("deleteLayoutsTitle", {
          layoutName: layout.name,
        });
    void confirm({
      title,
      prompt,
      ok: t("delete", { ns: "cosGeneral" }),
      cancel: t("cancel", { ns: "cosGeneral" }),
      variant: "danger",
    }).then((response) => {
      if (response === "ok" && isMounted()) {
        onDelete(layout);
      }
    });
  }, [confirm, isMounted, layout, multiSelection, t, onDelete]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenuTarget((target) =>
      target == undefined
        ? { type: "position", mouseX: event.clientX, mouseY: event.clientY }
        : undefined,
    );
  }, []);

  const handleMenuButtonClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const { currentTarget } = event;
    setContextMenuTarget((target) =>
      target == undefined ? { type: "element", element: currentTarget } : undefined,
    );
  }, []);

  const handleClose = useCallback(() => {
    setContextMenuTarget(undefined);
  }, []);

  const menuItems: (boolean | LayoutActionMenuItem)[] = [
    ...(onRename != undefined
      ? [
          {
            type: "item",
            key: "rename",
            text: t("rename"),
            onClick: renameAction,
            "data-testid": "rename-layout",
            disabled: (layoutIsProject(layout) && !isOnline) || multiSelection,
            secondaryText: layoutIsProject(layout) && !isOnline ? "Offline" : undefined,
          } as LayoutActionMenuItem,
        ]
      : []),
    // For shared layouts, duplicate first requires saving or discarding changes
    !(layoutIsProject(layout) && hasModifications) && {
      type: "item",
      key: "duplicate",
      text:
        layoutManager.supportsSharing && layoutIsProject(layout)
          ? t("makeAPersonalCopy")
          : t("duplicate"),
      onClick: duplicateAction,
      "data-testid": "duplicate-layout",
    },
    layoutManager.supportsSharing &&
      !layoutIsProject(layout) && {
        type: "item",
        key: "share",
        text: t("shareWithTeam"),
        onClick: shareAction,
        disabled: !isOnline || multiSelection,
        secondaryText: !isOnline ? "Offline" : undefined,
      },
    {
      type: "item",
      key: "export",
      text: t("export"),
      disabled: multiSelection,
      onClick: exportAction,
    },
    { key: "divider_1", type: "divider" },
    ...(onDelete != undefined
      ? [
          {
            type: "item",
            key: "delete",
            text: t("delete"),
            onClick: confirmDelete,
            "data-testid": "delete-layout",
          } as LayoutActionMenuItem,
        ]
      : []),
  ];

  if (hasModifications || anySelectedModifiedLayouts) {
    const sectionItems: LayoutActionMenuItem[] = [
      ...(onOverwrite != undefined
        ? [
            {
              type: "item",
              key: "overwrite",
              text: t("saveChanges"),
              onClick: overwriteAction,
              disabled: deletedOnServer || (layoutIsProject(layout) && !isOnline),
              secondaryText: layoutIsProject(layout) && !isOnline ? "Offline" : undefined,
            } as LayoutActionMenuItem,
          ]
        : []),
      ...(onRevert != undefined
        ? [
            {
              type: "item",
              key: "revert",
              text: t("revert"),
              onClick: confirmRevert,
              disabled: deletedOnServer,
            } as LayoutActionMenuItem,
          ]
        : []),
    ];
    if (layoutIsProject(layout)) {
      sectionItems.push({
        type: "item",
        key: "copy_to_personal",
        text: t("copyToPersonal"),
        disabled: multiSelection,
        onClick: makePersonalCopyAction,
      });
    }

    const unsavedChangesMessage = anySelectedModifiedLayouts
      ? t("theseLayoutsHaveUnsavedChanges")
      : t("thisLayoutHasUnsavedChanges");

    menuItems.unshift(
      ...(onOverwrite != undefined && onDelete != undefined
        ? [
            {
              key: "changes",
              type: "header",
              text: deletedOnServer ? t("someoneElseHasDeletedThisLayout") : unsavedChangesMessage,
            } as LayoutActionMenuItem,
          ]
        : []),
      ...sectionItems,
      { key: "changes_divider", type: "divider" },
    );
  }

  const filteredItems = menuItems.filter(
    (item): item is LayoutActionMenuItem => typeof item === "object",
  );

  const actionIcon = useMemo(
    () =>
      deletedOnServer ? (
        <ErrorIcon fontSize="small" color="error" />
      ) : hasModifications ? (
        <SvgIcon fontSize="small" color="primary">
          <circle cx={12} cy={12} r={4} />
        </SvgIcon>
      ) : (
        <MoreVertIcon fontSize="small" />
      ),
    [deletedOnServer, hasModifications],
  );

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  return (
    <StyledListItem
      editingName={editingName}
      hasModifications={hasModifications}
      deletedOnServer={deletedOnServer}
      disablePadding
      secondaryAction={
        <IconButton
          data-testid="layout-actions"
          aria-controls={contextMenuTarget != undefined ? "layout-action-menu" : undefined}
          aria-haspopup="true"
          aria-expanded={contextMenuTarget != undefined ? "true" : undefined}
          onClick={handleMenuButtonClick}
          onContextMenu={handleContextMenu}
        >
          {actionIcon}
        </IconButton>
      }
    >
      <ListItemButton
        data-testid="layout-list-item"
        selected={selected || multiSelectedIds.includes(layout.id)}
        onSubmit={onSubmit}
        onClick={editingName ? undefined : onClick}
        onContextMenu={editingName ? undefined : handleContextMenu}
        component="form"
      >
        <ListItemText disableTypography>
          <TextField
            inputRef={nameInputRef}
            value={nameFieldValue}
            onChange={(event) => {
              setNameFieldValue(event.target.value);
            }}
            onKeyDown={onTextFieldKeyDown}
            onBlur={onBlur}
            fullWidth
            style={{
              font: "inherit",
              display: editingName ? "inline" : "none",
            }}
            size="small"
            variant="filled"
          />
          <Typography
            component="span"
            variant="inherit"
            color="inherit"
            noWrap
            style={{ display: editingName ? "none" : "block" }}
          >
            <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
              <HighlightedText text={layout.name} highlight={searchQuery} />
            </Stack>
          </Typography>
        </ListItemText>
      </ListItemButton>
      <Menu
        id="layout-action-menu"
        open={contextMenuTarget != undefined}
        disableAutoFocus
        disableRestoreFocus
        anchorReference={contextMenuTarget?.type === "position" ? "anchorPosition" : "anchorEl"}
        anchorPosition={
          contextMenuTarget?.type === "position"
            ? { top: contextMenuTarget.mouseY, left: contextMenuTarget.mouseX }
            : undefined
        }
        anchorEl={contextMenuTarget?.element}
        onClose={handleClose}
        aria-labelledby="layout-actions"
        data-tourid="layout-actions"
        slotProps={{
          list: {
            dense: true,
          },
        }}
      >
        {filteredItems.map((item) => {
          switch (item.type) {
            case "divider":
              return <Divider key={item.key} variant="middle" />;
            case "item":
              return (
                <StyledMenuItem
                  debug={item.debug}
                  disabled={item.disabled}
                  key={item.key}
                  data-testid={item["data-testid"]}
                  onClick={(event) => {
                    item.onClick?.(event);
                    handleClose();
                  }}
                >
                  <Typography variant="inherit" color={item.key === "delete" ? "error" : undefined}>
                    {item.text}
                  </Typography>
                </StyledMenuItem>
              );
            case "header":
              return (
                <MenuItem disabled key={item.key}>
                  {item.text}
                </MenuItem>
              );
            default:
              return undefined;
          }
        })}
      </Menu>
    </StyledListItem>
  );
});
