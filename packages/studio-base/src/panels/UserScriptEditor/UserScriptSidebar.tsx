// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button, CircularProgress, Divider, IconButton, Link, Typography } from "@mui/material";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Group,
  Panel as ResizablePanel,
  PanelImperativeHandle,
  Separator,
} from "react-resizable-panels";
import { useLatest } from "react-use";
import tc from "tinycolor2";
import { makeStyles } from "tss-react/mui";
import { v4 as uuidv4 } from "uuid";

import EmptyState from "@foxglove/studio-base/components/EmptyState";
import Stack from "@foxglove/studio-base/components/Stack";
import {
  LayoutID,
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { useUserScriptState } from "@foxglove/studio-base/context/UserScriptStateContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { getUtilityFiles } from "@foxglove/studio-base/players/UserScriptPlayer/transformerWorker/typescript/rawUserUtils";
import { UserScripts } from "@foxglove/studio-base/types/panels";
import { getDocsLink } from "@foxglove/studio-base/util/getDocsLink";
import { DEFAULT_STUDIO_SCRIPT_PREFIX } from "@foxglove/studio-base/util/globalConstants";

import BottomBar from "./BottomBar";
import { ScriptPicker } from "./ScriptPicker";
import { Script } from "./script";

const Editor = React.lazy(async () => await import("./Editor"));

const skeletonBody = `\
// The ./types module provides helper types for your Input events and messages.
import { Input, Message } from "./types";

// Your script can output well-known message types, any of your custom message types, or
// complete custom message types.
//
// Use \`Message\` to access types from the schemas defined in your data source:
// type Twist = Message<"geometry_msgs/Twist">;
//
// Import from the @foxglove/schemas package to use foxglove schema types:
// import { Pose, LocationFix } from "@foxglove/schemas";
//
// Conventionally, it's common to make a _type alias_ for your script's output type
// and use that type name as the return type for your script function.
// Here we've called the type \`Output\` but you can pick any type name.
type Output = {
  hello: string;
};

// These are the topics your script "subscribes" to. Studio will invoke your script function
// when any message is received on one of these topics.
export const inputs = ["/input/topic"];

// Any output your script produces is "published" to this topic. Published messages are only visible within Studio, not to your original data source.
export const output = "/studio_script/output_topic";

// This function is called with messages from your input topics.
// The first argument is an event with the topic, receive time, and message.
// Use the \`Input<...>\` helper to get the correct event type for your input topic messages.
export default function script(event: Input<"/input/topic">): Output {
  return {
    hello: "world!",
  };
};`;

const useStyles = makeStyles()((theme) => ({
  resizeHandle: {
    position: "relative",
    height: 10,
    marginTop: -10,

    ":hover": {
      backgroundPosition: "50% 0",
      backgroundSize: "100% 50px",
      backgroundImage: `radial-gradient(${[
        "at center center",
        `${theme.palette.action.focus} 0%`,
        "transparent 70%",
        "transparent 100%",
      ].join(",")})`,
      boxShadow: `0 2px 0 0 ${
        theme.palette.mode === "dark"
          ? tc(theme.palette.divider).lighten().toString()
          : tc(theme.palette.divider).darken().toString()
      }`,
    },
  },
}));

const WelcomeScreen = ({ addNewNode }: { addNewNode: (code?: string) => void }) => {
  const { t } = useTranslation("userScriptEditor");
  return (
    <Stack justifyContent="center" alignItems="center" gap={1} padding={1} fullHeight>
      <Typography align="center" variant="body2" gutterBottom>
        <Trans
          ns="userScriptEditor"
          i18nKey="welcomeDescription"
          components={{
            br: <br />,
            link: (
              <Link
                color="primary"
                underline="hover"
                href={getDocsLink("/viz/panel/user-scripts")}
                target="_blank"
              />
            ),
          }}
        />
      </Typography>
      <Button
        color="inherit"
        variant="contained"
        onClick={() => {
          addNewNode();
        }}
        startIcon={<AddIcon />}
      >
        {t("newScript")}
      </Button>
    </Stack>
  );
};

const emptyScripts: UserScripts = {};
const selectLayoutId = (state: LayoutState) =>
  state.selectedLayout?.data != undefined ? state.selectedLayout.id : undefined;
const selectScripts = (state: LayoutState) => state.selectedLayout?.data?.userNodes ?? emptyScripts;

export default function UserScriptSidebar(): React.JSX.Element {
  const { t } = useTranslation("userScriptEditor");
  const layoutId = useCurrentLayoutSelector(selectLayoutId);
  const userScripts = useCurrentLayoutSelector(selectScripts);
  const config = useWorkspaceStore((store) => store.sidebars.right.userScriptEditor);
  if (layoutId == undefined) {
    return <EmptyState>{t("openLayout")}</EmptyState>;
  }
  const selectedId = config?.selectedNodeId;
  const scriptId =
    selectedId != undefined && userScripts[selectedId] != undefined
      ? selectedId
      : Object.keys(userScripts)[0];
  return (
    <ScriptWorkspace
      key={JSON.stringify([layoutId, scriptId])}
      layoutId={layoutId}
      scriptId={scriptId}
      userScripts={userScripts}
      autoFormatOnSave={config?.autoFormatOnSave ?? true}
    />
  );
}

function ScriptWorkspace({
  layoutId,
  scriptId,
  userScripts,
  autoFormatOnSave,
}: {
  layoutId: LayoutID;
  scriptId?: string;
  userScripts: UserScripts;
  autoFormatOnSave: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("userScriptEditor");
  const { getCurrentLayoutState, setUserScripts } = useCurrentLayoutActions();
  const {
    sidebarActions: {
      right: { updateUserScriptEditor },
    },
  } = useWorkspaceActions();
  const rosLib = useUserScriptState((store) => store.state.rosLib);
  const typesLib = useUserScriptState((store) => store.state.typesLib);
  const state = useUserScriptState((store) =>
    scriptId != undefined ? store.state.scriptStates[scriptId] : undefined,
  );
  const interruptedDrafts = useUserScriptState((store) => store.interruptedDrafts);
  const draftKey = JSON.stringify([layoutId, scriptId])!;
  const [draft, setDraft] = useState(() => interruptedDrafts.get(draftKey));
  const [utilities, setUtilities] = useState<Script[]>([]);
  const selected = scriptId != undefined ? userScripts[scriptId] : undefined;
  const editedCode = draft?.sourceCode === selected?.sourceCode ? draft?.editedCode : undefined;
  const extensions = useExtensionCatalog((store) => store.installedUserScriptUtilities);
  const convention = selected == undefined ? "standard" : selected.rotationConvention;
  const files = useMemo(() => getUtilityFiles(extensions, convention), [extensions, convention]);
  const lastUtility = utilities.at(-1);
  const utility = useMemo(() => {
    if (lastUtility?.filePath.startsWith(DEFAULT_STUDIO_SCRIPT_PREFIX) !== true) {
      return lastUtility;
    }
    const name = lastUtility.filePath.slice(DEFAULT_STUDIO_SCRIPT_PREFIX.length);
    const code =
      name === "generatedTypes.ts"
        ? typesLib
        : files.find((file) => file.fileName === name)?.sourceCode;
    return code != undefined ? { ...lastUtility, code } : undefined;
  }, [files, lastUtility, typesLib]);
  const currentScript = useMemo<Script | undefined>(() => {
    if (utility || scriptId == undefined || !selected) {
      return utility;
    }
    return {
      // The model shares a directory with utilities for relative imports. A stable ID
      // prevents a rename or a script called "types.ts" from replacing a utility model.
      filePath: `user-script-${encodeURIComponent(scriptId)}.ts`,
      code: editedCode ?? selected.sourceCode,
      readOnly: false,
    };
  }, [editedCode, scriptId, selected, utility]);

  const save = useCallback(
    (code: string) => {
      const layout = getCurrentLayoutState().selectedLayout;
      const live = scriptId != undefined ? layout?.data?.userNodes[scriptId] : undefined;
      if (
        layout?.id === layoutId &&
        scriptId != undefined &&
        live &&
        live.sourceCode === selected?.sourceCode &&
        live.sourceCode !== code
      ) {
        setUserScripts({ [scriptId]: { ...live, sourceCode: code } });
        setDraft(undefined);
      }
    },
    [getCurrentLayoutState, layoutId, scriptId, selected?.sourceCode, setUserScripts],
  );

  const saveOnLeave = useLatest(() => {
    interruptedDrafts.delete(draftKey);
    if (draft == undefined || editedCode == undefined) {
      return;
    }
    // Layout selection changes synchronously, before React unmounts the old sidebar.
    // A detached editor must never dispatch a save into the newly selected layout.
    const layout = getCurrentLayoutState().selectedLayout;
    if (layout?.id !== layoutId || layout.data == undefined) {
      interruptedDrafts.set(draftKey, draft);
    } else {
      save(editedCode);
    }
  });
  useEffect(
    () => () => {
      saveOnLeave.current();
    },
    [saveOnLeave],
  );

  const addScript = (sourceCode = skeletonBody, name?: string) => {
    const id = uuidv4();
    setUserScripts({
      [id]: { name: name ?? id.split("-")[0]!, sourceCode, rotationConvention: "standard" },
    });
    updateUserScriptEditor({ selectedNodeId: id });
  };
  const bottomBarRef = useRef<PanelImperativeHandle>(ReactNull);
  return (
    <Stack fullHeight overflow="hidden">
      <ScriptPicker
        scripts={userScripts}
        selectedId={scriptId}
        utility={utility}
        files={files}
        typesLib={typesLib}
        selectScript={(selectedNodeId) => {
          setUtilities([]);
          updateUserScriptEditor({ selectedNodeId });
        }}
        selectUtility={(script) => {
          setUtilities([script]);
        }}
        addScript={addScript}
        renameScript={(name) => {
          const layout = getCurrentLayoutState().selectedLayout;
          const live = scriptId != undefined ? layout?.data?.userNodes[scriptId] : undefined;
          if (layout?.id === layoutId && scriptId != undefined && live && live.name !== name) {
            setUserScripts({ [scriptId]: { ...live, name } });
          }
        }}
        deleteScript={() => {
          const layout = getCurrentLayoutState().selectedLayout;
          if (
            scriptId != undefined &&
            layout?.id === layoutId &&
            layout.data != undefined &&
            selected != undefined &&
            layout.data.userNodes[scriptId] === selected
          ) {
            setUserScripts({ [scriptId]: undefined });
            updateUserScriptEditor({
              selectedNodeId: Object.keys(layout.data.userNodes).find((id) => id !== scriptId),
            });
          }
        }}
        autoFormatOnSave={autoFormatOnSave}
        toggleRotation={() => {
          if (scriptId != undefined && selected) {
            setUserScripts({
              [scriptId]: {
                ...selected,
                rotationConvention:
                  selected.rotationConvention === "standard" ? undefined : "standard",
              },
            });
          }
        }}
        toggleAutoFormat={() => {
          updateUserScriptEditor({ autoFormatOnSave: !autoFormatOnSave });
        }}
      />
      <Divider />
      {utility && (
        <Stack direction="row" alignItems="center">
          <IconButton
            title={t("goBack")}
            size="small"
            onClick={() => {
              setUtilities((stack) => stack.slice(0, -1));
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="caption" noWrap>
            {utility.filePath}
            {t("readonlySuffix")}
          </Typography>
        </Stack>
      )}
      <Group orientation="vertical">
        <ResizablePanel>
          {currentScript ? (
            <Suspense fallback={<CircularProgress size={28} />}>
              <Editor
                files={files}
                autoFormatOnSave={autoFormatOnSave}
                script={currentScript}
                setScriptCode={(edited) => {
                  if (selected && !utility) {
                    setDraft(
                      edited === selected.sourceCode
                        ? undefined
                        : { sourceCode: selected.sourceCode, editedCode: edited },
                    );
                  }
                }}
                setScriptOverride={(script) => {
                  setUtilities((stack) => [...stack, script]);
                }}
                rosLib={rosLib}
                typesLib={typesLib}
                save={save}
              />
            </Suspense>
          ) : (
            <WelcomeScreen addNewNode={addScript} />
          )}
        </ResizablePanel>
        <Separator className={classes.resizeHandle} />
        <ResizablePanel
          collapsible
          collapsedSize={0}
          defaultSize="30%"
          style={{ minHeight: 38 }}
          panelRef={bottomBarRef}
        >
          <BottomBar
            diagnostics={state?.diagnostics ?? []}
            isSaved={editedCode == undefined || utility != undefined}
            logs={state?.logs ?? []}
            scriptId={scriptId}
            onChangeTab={() => bottomBarRef.current?.expand()}
            save={() => {
              if (editedCode != undefined) {
                save(editedCode);
              }
            }}
          />
        </ResizablePanel>
      </Group>
    </Stack>
  );
}
