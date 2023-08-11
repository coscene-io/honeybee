// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import CancelIcon from "@mui/icons-material/Cancel";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";
import {
  Menu,
  PaperProps,
  Divider,
  MenuItem as MuiMenuItem,
  SvgIconProps,
  SvgIcon,
  MenuItem,
} from "@mui/material";
import { IconButton, TextField, List } from "@mui/material";
import { partition } from "lodash";
import { useRef, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import useAsyncFn from "react-use/lib/useAsyncFn";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { AppBarDropdownButton } from "@foxglove/studio-base/components/AppBar/AppBarDropdownButton";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

// import LayoutRow from "./CoSceneLayoutRow";

const log = Logger.getLogger(__filename);

const useStyles = makeStyles()((theme) => {
  const { spacing, palette } = theme;

  return {
    menuList: {
      minWidth: 320,
      // padding: theme.spacing(1),
      paddingBottom: theme.spacing(1),
    },
    toolbar: {
      position: "sticky",
      top: -0.5, // yep that's a half pixel to avoid a gap between the appbar and panel top
      zIndex: 100,
      display: "flex",
      justifyContent: "stretch",
      padding: theme.spacing(1),
      backgroundImage: `linear-gradient(to top, transparent, ${palette.background.paper} ${spacing(
        1.5,
      )}) !important`,
    },
    toolbarMenu: {
      backgroundImage: `linear-gradient(to top, transparent, ${palette.background.menu} ${spacing(
        1.5,
      )}) !important`,
    },
    iconButtonSmall: {
      padding: theme.spacing(0.91125), // round out the overall height to 30px
      borderRadius: 0,
    },
    pointIcon: {
      userSelect: "none",
      width: "1em",
      height: "1em",
      display: "inline-block",
      fill: "currentColor",
      flexShrink: 0,
      transition: "fill 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms",
      fontSize: "1.07143rem",
      color: "#3b82f6",
    },
    layoutItem: {
      display: "flex",
      justifyContent: "space-between",
    },
  };
});

const PointIcon = (props: SvgIconProps) => {
  return (
    <SvgIcon {...props}>
      <g>
        <circle cx="12" cy="12" r="4"></circle>
      </g>
    </SvgIcon>
  );
};

const ActionMenu = ({
  allowShare,
  onReset,
  onShare,
  fontSize = "medium",
}: {
  allowShare: boolean;
  onReset: () => void;
  onShare: () => void;
  fontSize?: SvgIconProps["fontSize"];
}) => {
  const { classes, cx } = useStyles();
  const [anchorEl, setAnchorEl] = React.useState<undefined | HTMLElement>();
  const { t } = useTranslation("panelSettings");
  const open = Boolean(anchorEl);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <div>
      <IconButton
        className={cx({ [classes.iconButtonSmall]: fontSize === "small" })}
        id="basic-button"
        aria-controls={open ? "basic-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        onClick={handleClick}
      >
        {/* <MoreVertIcon fontSize={fontSize} /> */}
        <PointIcon className={classes.pointIcon} fontSize={fontSize} />
      </IconButton>
      <Menu
        id="basic-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "basic-button",
        }}
      >
        <MenuItem
          disabled={!allowShare}
          onClick={() => {
            onShare();
            handleClose();
          }}
        >
          {t("importOrExportSettingsWithEllipsis")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onReset();
            handleClose();
          }}
        >
          {t("resetToDefaults")}
        </MenuItem>
      </Menu>
    </div>
  );
};

export function CoSceneLayoutButton(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const { classes, cx } = useStyles();
  const anchorEl = useRef<HTMLButtonElement>(ReactNull);
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedPanelIdx, setHighlightedPanelIdx] = useState<number | undefined>();
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const query = event.target.value;
    setSearchQuery(query);

    // When there is a search query, automatically highlight the first (0th) item.
    // When the user erases the query, remove the highlight.
    setHighlightedPanelIdx(query ? 0 : undefined);
  }, []);
  const { layoutActions } = useWorkspaceActions();
  // const { getCurrentLayoutState, setCurrentLayout } = useCurrentLayoutActions();

  const layoutManager = useLayoutManager();

  const [layouts, reloadLayouts] = useAsyncFn(
    async () => {
      const [shared, personal] = partition(
        await layoutManager.getLayouts(),
        layoutManager.supportsSharing ? layoutIsShared : () => false,
      );
      return {
        personal: personal.sort((a, b) => a.name.localeCompare(b.name)),
        shared: shared.sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    [layoutManager],
    { loading: true },
  );

  useEffect(() => {
    const listener = () => void reloadLayouts();
    layoutManager.on("change", listener);
    return () => layoutManager.off("change", listener);
  }, [layoutManager, reloadLayouts]);

  // Start loading on first mount
  useEffect(() => {
    reloadLayouts().catch((err) => log.error(err));
  }, [reloadLayouts]);

  const items = layouts.value?.personal;

  const appBarMenuItems = [
    {
      type: "item",
      key: "item1",
      label: "import from file...",
      onClick: () => {
        layoutActions.importFromFile();
        setMenuOpen(false);
      },
    },
    { type: "item", key: "item2", label: "App Context Item 2", onClick: () => {} },
    { type: "divider" },
  ];

  return (
    <>
      <AppBarDropdownButton
        subheader="layout"
        title="test"
        selected={menuOpen}
        onClick={() => {
          setMenuOpen((open) => !open);
        }}
        ref={anchorEl}
      />
      <Menu
        id="add-panel-menu"
        anchorEl={anchorEl.current}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        MenuListProps={{
          dense: true,
          disablePadding: true,
          "aria-labelledby": "add-panel-button",
          className: classes.menuList,
        }}
        anchorOrigin={{
          horizontal: "right",
          vertical: "bottom",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        PaperProps={
          {
            "data-tourid": "add-panel-menu",
          } as Partial<PaperProps & { "data-tourid"?: string }>
        }
      >
        <div className={cx(classes.toolbar, classes.toolbarMenu)}>
          <TextField
            fullWidth
            variant="filled"
            placeholder={t("searchPanels", { ns: "addPanel" })}
            value={searchQuery}
            onChange={handleSearchChange}
            // onKeyDown={onKeyDown}
            autoFocus
            data-testid="panel-list-textfield"
            InputProps={{
              startAdornment: <SearchIcon fontSize="small" />,
              endAdornment: searchQuery && (
                <IconButton size="small" edge="end" onClick={() => setSearchQuery("")}>
                  <CancelIcon fontSize="small" />
                </IconButton>
              ),
            }}
          />
        </div>
        {appBarMenuItems.map((item, idx) =>
          item.type === "divider" ? (
            <Divider key={`divider${idx}`} />
          ) : (
            <MuiMenuItem
              key={item.key}
              onClick={item.onClick}
              // onPointerEnter={() => setNestedMenu(undefined)}
            >
              {item.label}
            </MuiMenuItem>
          ),
        )}

        {items?.map((layout) => (
          <MuiMenuItem
            key={1}
            onClick={() => {
              // console.log(getCurrentLayoutState());
            }}
            // onPointerEnter={() => setNestedMenu(undefined)}
            className={classes.layoutItem}
          >
            {layout.name}
            <ActionMenu
              key={1}
              fontSize="small"
              allowShare={true}
              onReset={() => {}}
              onShare={() => {}}
            />
          </MuiMenuItem>
        ))}
        {/* <MuiMenuItem
          key={1}
          onClick={() => {
            // console.log(getCurrentLayoutState());
          }}
          // onPointerEnter={() => setNestedMenu(undefined)}
          className={classes.layoutItem}
        >
          label name
          <ActionMenu
            key={1}
            fontSize="small"
            allowShare={true}
            onReset={() => {}}
            onShare={() => {}}
          />
        </MuiMenuItem> */}
      </Menu>
    </>
  );
}
