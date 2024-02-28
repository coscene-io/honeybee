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
  Chip,
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

// import { withStyles } from "tss-react/mui";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import { UserStore, useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

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

const selectUserRole = (store: UserStore) => store.role;

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
  onRecommendedToProjectLayout,
  onCopyToRecordDefaultLayout,
}: {
  layout: Layout;
  anySelectedModifiedLayouts: boolean;
  multiSelectedIds: readonly string[];
  selected: boolean;
  searchQuery: string;
  onSelect: (item: Layout, params?: { selectedViaClick?: boolean; event?: MouseEvent }) => void;
  onRename: (item: Layout, newName: string) => void;
  onDuplicate: (item: Layout) => void;
  onDelete: (item: Layout) => void;
  onShare: (item: Layout) => void;
  onExport: (item: Layout) => void;
  onOverwrite: (item: Layout) => void;
  onRevert: (item: Layout) => void;
  onMakePersonalCopy: (item: Layout) => void;
  onRecommendedToProjectLayout?: (item: Layout) => void;
  onCopyToRecordDefaultLayout?: (item: Layout) => void;
}): JSX.Element {
  const isMounted = useMountedState();
  const [confirm, confirmModal] = useConfirm();
  const layoutManager = useLayoutManager();
  const { t } = useTranslation("cosLayout");
  const currentUserRole = useCurrentUser(selectUserRole);

  const [editingName, setEditingName] = useState(false);
  const [nameFieldValue, setNameFieldValue] = useState("");
  const [isOnline, setIsOnline] = useState(layoutManager.isOnline);
  const [contextMenuTarget, setContextMenuTarget] = useState<
    | { type: "position"; mouseX: number; mouseY: number; element?: undefined }
    | { type: "element"; element: Element }
    | undefined
  >(undefined);

  const deletedOnServer = layout.syncInfo?.status === "remotely-deleted";
  const hasModifications = layout.working != undefined;
  const multiSelection = multiSelectedIds.length > 1;

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
    onOverwrite(layout);
  }, [layout, onOverwrite]);

  const confirmRevert = useCallback(async () => {
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

  const recommendedToProjectAction = useCallback(() => {
    if (onRecommendedToProjectLayout) {
      onRecommendedToProjectLayout(layout);
    }
  }, [layout, onRecommendedToProjectLayout]);

  const copyToRecordDefaultAction = useCallback(() => {
    if (onCopyToRecordDefaultLayout) {
      onCopyToRecordDefaultLayout(layout);
    }
  }, [layout, onCopyToRecordDefaultLayout]);

  const onSubmit = useCallback(
    (event: React.FormEvent) => {
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
    const layoutWarning =
      !multiSelection && layoutIsShared(layout) ? t("deleteLayoutsWarning") : "";
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
    {
      type: "item",
      key: "rename",
      text: t("rename"),
      onClick: renameAction,
      "data-testid": "rename-layout",
      disabled: (layoutIsShared(layout) && !isOnline) || multiSelection,
      secondaryText: layoutIsShared(layout) && !isOnline ? "Offline" : undefined,
    },
    // For shared layouts, duplicate first requires saving or discarding changes
    !(layoutIsShared(layout) && hasModifications) && {
      type: "item",
      key: "duplicate",
      text:
        layoutManager.supportsSharing && layoutIsShared(layout)
          ? t("makeAPersonalCopy")
          : t("duplicate"),
      onClick: duplicateAction,
      "data-testid": "duplicate-layout",
    },
    layoutIsShared(layout) &&
      onRecommendedToProjectLayout != undefined &&
      (currentUserRole.organizationRole === "ORGANIZATION_ADMIN" ||
        currentUserRole.projectRole === "PROJECT_ADMIN") && {
        type: "item",
        key: "recommendedToProjectLayout",
        text: layout.isProjectRecommended
          ? t("removeProjectRecommendedLayout")
          : t("markAsProjectRecommendedLayout"),
        onClick: recommendedToProjectAction,
        "data-testid": "recommended-project-layout",
      },
    onCopyToRecordDefaultLayout != undefined &&
      !layout.isRecordRecommended &&
      (currentUserRole.organizationRole !== "ORGANIZATION_READER" ||
        currentUserRole.projectRole !== "PROJECT_READER") && {
        type: "item",
        key: "copyToRecordDefaultLayout",
        text: t("copyToRecordDefaultLayoutTitle"),
        onClick: copyToRecordDefaultAction,
        "data-testid": "copy-to-record-default-layout",
      },
    layoutManager.supportsSharing &&
      !layoutIsShared(layout) && {
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
    {
      type: "item",
      key: "delete",
      text: t("delete"),
      onClick: confirmDelete,
      "data-testid": "delete-layout",
    },
  ];

  if (hasModifications || anySelectedModifiedLayouts) {
    const sectionItems: LayoutActionMenuItem[] = [
      {
        type: "item",
        key: "overwrite",
        text: t("saveChanges"),
        onClick: overwriteAction,
        disabled: deletedOnServer || (layoutIsShared(layout) && !isOnline),
        secondaryText: layoutIsShared(layout) && !isOnline ? "Offline" : undefined,
      },
      {
        type: "item",
        key: "revert",
        text: t("revert"),
        onClick: confirmRevert,
        disabled: deletedOnServer,
      },
    ];
    if (layoutIsShared(layout)) {
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
      {
        key: "changes",
        type: "header",
        text: deletedOnServer ? t("someoneElseHasDeletedThisLayout") : unsavedChangesMessage,
      },
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
      {confirmModal}
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
            <Stack direction="row" spacing={2} alignItems="center">
              <HighlightedText text={layout.name} highlight={searchQuery} />
              {layout.isProjectRecommended && (
                <Chip label={t("projectRecommandedLayout")} color="success" size="small" />
              )}
              {layout.isRecordRecommended && (
                <Chip label={t("recordDefaultLayout")} color="success" size="small" />
              )}
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
        MenuListProps={{
          "aria-labelledby": "layout-actions",
          dense: true,
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
