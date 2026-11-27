// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.
//

import { Badge, Button, Divider, Paper, Tab, Tabs, badgeClasses, tabClasses } from "@mui/material";
import { ReactElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCopyToClipboard } from "react-use";
import { makeStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";
import {
  UserScriptStore,
  useUserScriptState,
} from "@foxglove/studio-base/context/UserScriptStateContext";
import { copyMessageReplacer } from "@foxglove/studio-base/panels/RawMessages/copyMessageReplacer";
import DiagnosticsSection from "@foxglove/studio-base/panels/UserScriptEditor/BottomBar/DiagnosticsSection";
import LogsSection from "@foxglove/studio-base/panels/UserScriptEditor/BottomBar/LogsSection";
import { Diagnostic, UserScriptLog } from "@foxglove/studio-base/players/UserScriptPlayer/types";

type Props = {
  diagnostics: readonly Diagnostic[];
  isSaved: boolean;
  logs: readonly UserScriptLog[];
  scriptId?: string;
  onChangeTab: () => void;
  save: () => void;
};

type BottomBarModes = "logs" | "diagnostics" | "timing";

function ScriptTimings(): React.JSX.Element {
  const { t } = useTranslation("userScriptEditor");
  const timings = useUserScriptState((store) => store.timings);
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      refresh((tick) => tick + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  if (timings == undefined || timings.size === 0) {
    return <Stack padding={1}>{t("noTimings")}</Stack>;
  }
  return (
    <Stack padding={1} gap={1}>
      {Array.from(timings, ([id, row]) => (
        <div key={id}>
          <strong>{row.name}</strong>
          <br />
          {t("timingSummary", {
            calls: row.calls,
            mean: row.calls > 0 ? (row.totalMs / row.calls).toFixed(2) : "—",
            max: row.calls > 0 ? row.maxMs.toFixed(2) : "—",
            compile: row.compileMs.toFixed(1),
          })}
        </div>
      ))}
    </Stack>
  );
}

const TAB_HEIGHT = 36;

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflowY: "hidden",
  },
  badge: {
    alignItems: "center",

    [`.${badgeClasses.badge}`]: {
      margin: theme.spacing(-0.25, 0, -0.25, 1),
      position: "relative",
      transform: "none",

      [`&.${badgeClasses.invisible}`]: {
        display: "none",
      },
    },
  },
  tabs: {
    minHeight: TAB_HEIGHT,
    position: "relative",
    bottom: -1,

    [`.${tabClasses.root}`]: {
      minHeight: "auto",
      minWidth: theme.spacing(8),
      padding: theme.spacing(1.5, 2),
      color: theme.palette.text.secondary,

      "&.Mui-selected": {
        color: theme.palette.text.primary,
      },
    },
  },
}));

const selectUserScriptActions = (store: UserScriptStore) => store.actions;

const BottomBar = ({
  diagnostics,
  isSaved,
  logs,
  scriptId,
  onChangeTab,
  save,
}: Props): ReactElement => {
  const { classes } = useStyles();
  const [bottomBarDisplay, setBottomBarDisplay] = useState<BottomBarModes>("diagnostics");
  const { t } = useTranslation("userScriptEditor");

  const [, copy] = useCopyToClipboard();
  const { clearUserScriptLogs } = useUserScriptState(selectUserScriptActions);

  const handleChange = (_event: React.SyntheticEvent, value: BottomBarModes) => {
    setBottomBarDisplay(value);
  };

  const handleClick = () => {
    onChangeTab();
  };

  return (
    <>
      <Paper elevation={0} className={classes.root}>
        <Divider />
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={1}
          paddingRight={1}
        >
          <Tabs
            className={classes.tabs}
            textColor="inherit"
            value={bottomBarDisplay}
            onChange={handleChange}
          >
            <Tab
              label={
                <Badge
                  color="error"
                  badgeContent={diagnostics.length}
                  invisible={diagnostics.length === 0}
                  className={classes.badge}
                >
                  {t("alertsTab")}
                </Badge>
              }
              value="diagnostics"
              data-testid="np-errors"
              onClick={() => {
                handleClick();
              }}
            />
            <Tab
              label={
                <Badge
                  color="error"
                  className={classes.badge}
                  badgeContent={logs.length}
                  invisible={logs.length === 0}
                >
                  {t("logsTab")}
                </Badge>
              }
              value="logs"
              data-testid="np-logs"
              onClick={() => {
                handleClick();
              }}
            />
            <Tab label={t("timingTab")} value="timing" onClick={handleClick} />
          </Tabs>
          <Stack direction="row" alignItems="center" gap={0.5} fullHeight>
            {bottomBarDisplay === "logs" && (
              <Button
                size="small"
                disabled={logs.length === 0}
                onClick={() => {
                  copy(
                    logs
                      .map(({ value }) => {
                        if (value == undefined || typeof value === "string") {
                          return String(value);
                        }
                        try {
                          return JSON.stringify(value, copyMessageReplacer);
                        } catch {
                          return Object.prototype.toString.call(value);
                        }
                      })
                      .join("\n"),
                  );
                }}
              >
                {t("copyLogs")}
              </Button>
            )}
            {bottomBarDisplay === "logs" && (
              <Button
                size="small"
                color="primary"
                variant="contained"
                data-testid="np-logs-clear"
                disabled={logs.length === 0}
                onClick={() => {
                  if (scriptId != undefined) {
                    clearUserScriptLogs(scriptId);
                  }
                }}
              >
                {t("clearLogs")}
              </Button>
            )}
            <Button
              size="small"
              color="primary"
              variant="contained"
              disabled={isSaved}
              title={t("saveShortcutHint")}
              onClick={() => {
                if (scriptId != undefined) {
                  save();
                  clearUserScriptLogs(scriptId);
                }
              }}
            >
              {isSaved ? t("saved") : t("save")}
            </Button>
          </Stack>
        </Stack>
        <Divider />
        {bottomBarDisplay === "timing" && <ScriptTimings />}
        {bottomBarDisplay === "diagnostics" && <DiagnosticsSection diagnostics={diagnostics} />}
        {bottomBarDisplay === "logs" && <LogsSection logs={logs} />}
      </Paper>
    </>
  );
};

export default BottomBar;
