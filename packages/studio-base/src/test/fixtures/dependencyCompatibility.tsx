// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FixedSizeList } from "react-window";

import { PanelExtensionContext } from "@foxglove/studio";
import AutoSizer from "@foxglove/studio-base/components/AutoSizer";
import Stack from "@foxglove/studio-base/components/Stack";
import { Indicator } from "@foxglove/studio-base/panels/Indicator/Indicator";
import DiagnosticStatus from "@foxglove/studio-base/panels/diagnostics/DiagnosticStatus";
import { DiagnosticId } from "@foxglove/studio-base/panels/diagnostics/util";
import { createMuiTheme } from "@foxglove/theme";

const noop = () => {};

function IndicatorExample({ style, matched }: { style: string; matched: boolean }) {
  const [context] = useState(
    () =>
      ({
        initialState: {
          path: "/value.data",
          style,
          fallbackColor: style === "background" ? "#ffffff" : "#ff0000",
          fallbackLabel: "Fallback",
          rules: [{ operator: "=", rawValue: "true", color: "#00ff00", label: "Matched" }],
        },
        watch: noop,
        subscribe: noop,
        unsubscribeAll: noop,
        saveState: noop,
        setDefaultPanelTitle: noop,
        updatePanelSettingsEditor: noop,
      }) as unknown as PanelExtensionContext,
  );
  useEffect(() => {
    if (matched) {
      context.onRender?.(
        {
          currentFrame: [
            {
              topic: "/value",
              schemaName: "value",
              receiveTime: { sec: 0, nsec: 0 },
              sizeInBytes: 0,
              message: { data: true },
            },
          ],
        },
        noop,
      );
    }
  }, [context, matched]);
  return (
    <div id={`indicator-${style}-${String(matched)}`} style={{ height: 150 }}>
      <Indicator context={context} />
    </div>
  );
}

function AutoSizedList() {
  return (
    <AutoSizer
      renderProp={({ height, width }) =>
        height != undefined && width != undefined && height > 0 && width > 0 ? (
          <FixedSizeList height={height} width={width} itemCount={100} itemSize={30}>
            {({ index, style }) => <div style={style}>{index}</div>}
          </FixedSizeList>
        ) : (
          ReactNull
        )
      }
    />
  );
}

function Fixture() {
  const [dark, setDark] = useState(true);
  const baseTheme = createMuiTheme(dark ? "dark" : "light", "en");
  const theme = createTheme({
    ...baseTheme,
    palette: {
      ...baseTheme.palette,
      mode: dark ? "dark" : "light",
      success: { main: "#008000" },
      warning: { main: "#ff8000" },
      error: { main: "#ff0000" },
    },
  });
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <button
        onClick={() => {
          setDark(!dark);
        }}
      >
        Toggle theme
      </button>
      <div id="layouts">
        {["topic", "log", "diagnostic"].map((kind) => (
          <div
            key={kind}
            id={kind}
            style={{
              display: "flex",
              flexDirection: "column",
              height: 400,
              width: 400,
              overflow: "hidden",
            }}
          >
            <div style={{ height: 40, flexShrink: 0 }}>Toolbar</div>
            {kind === "topic" ? (
              <div style={{ flex: "1 1 100%" }}>
                <AutoSizedList />
              </div>
            ) : (
              <Stack flex="auto">
                <AutoSizedList />
              </Stack>
            )}
          </div>
        ))}
      </div>
      {["text", "bulb", "background"].flatMap((style) =>
        [false, true].map((matched) => (
          <IndicatorExample key={`${style}-${String(matched)}`} style={style} matched={matched} />
        )),
      )}
      {[0, 1, 2, 3].map((level) => (
        <div id={`diagnostic-${level}`} key={level}>
          <DiagnosticStatus
            info={{
              id: `status-${level}` as DiagnosticId,
              displayName: `Status ${level}`,
              stamp: { sec: 0, nsec: 0 },
              status: {
                name: `Status ${level}`,
                hardware_id: "test",
                level,
                message: `Message ${level}`,
                values: [],
              },
            }}
            topicToRender="/diagnostics"
            numericPrecision={undefined}
            splitFraction={0.5}
            onChangeSplitFraction={noop}
            openSiblingPanel={noop}
          />
        </div>
      ))}
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
