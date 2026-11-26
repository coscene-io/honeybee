// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Delete20Regular, Edit20Regular } from "@fluentui/react-icons";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { Autocomplete, IconButton, TextField } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";
import { usePrompt } from "@foxglove/studio-base/hooks/useCoScenePrompt";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import templates from "@foxglove/studio-base/players/UserScriptPlayer/transformerWorker/typescript/templates";
import type { UserScriptProjectFile } from "@foxglove/studio-base/players/UserScriptPlayer/transformerWorker/typescript/types";
import { UserScripts } from "@foxglove/studio-base/types/panels";
import { DEFAULT_STUDIO_SCRIPT_PREFIX } from "@foxglove/studio-base/util/globalConstants";

import { Script } from "./script";

type Choice = { label: string } & (
  | { kind: "scriptsHeader"; id: string }
  | { kind: "utilitiesHeader"; sourceCode: string }
  | { kind: "templatesHeader"; sourceCode: string }
  | { kind: "rotationSetting" }
  | { kind: "newScript" }
);

type Props = {
  scripts: UserScripts;
  files: readonly Pick<UserScriptProjectFile, "fileName" | "sourceCode">[];
  selectedId?: string;
  utility?: Script;
  typesLib: string;
  selectScript: (id: string) => void;
  selectUtility: (utility: Script) => void;
  addScript: (code?: string, name?: string) => void;
  renameScript: (name: string) => void;
  deleteScript: () => void;
  autoFormatOnSave: boolean;
  toggleAutoFormat: () => void;
  toggleRotation: () => void;
};

export function ScriptPicker({
  scripts,
  files,
  selectedId,
  utility,
  typesLib,
  selectScript,
  selectUtility,
  addScript,
  renameScript,
  deleteScript,
  autoFormatOnSave,
  toggleAutoFormat,
  toggleRotation,
}: Props): React.JSX.Element {
  const { t } = useTranslation("userScriptEditor");
  const confirm = useConfirm();
  const [prompt, promptModal] = usePrompt();
  const choices = useMemo<Choice[]>(
    () => [
      ...Object.entries(scripts).map(([id, script]) => ({
        kind: "scriptsHeader" as const,
        label: script.name,
        id,
      })),
      ...[...files, { fileName: "generatedTypes.ts", sourceCode: typesLib }].map(
        ({ fileName, sourceCode }) => ({
          kind: "utilitiesHeader" as const,
          label: fileName,
          sourceCode,
        }),
      ),
      ...(selectedId == undefined
        ? []
        : [
            {
              kind: "rotationSetting" as const,
              label: t(
                scripts[selectedId]?.rotationConvention === "standard"
                  ? "switchToLegacyRotation"
                  : "switchToStandardRotation",
              ),
            },
          ]),
      { kind: "newScript", label: t("newScript") },
      ...templates.map(({ name, template }) => ({
        kind: "templatesHeader" as const,
        label: name,
        sourceCode: template,
      })),
    ],
    [files, scripts, selectedId, t, typesLib],
  );
  const selected = choices.find((choice) =>
    utility
      ? choice.kind === "utilitiesHeader" &&
        DEFAULT_STUDIO_SCRIPT_PREFIX + choice.label === utility.filePath
      : choice.kind === "scriptsHeader" && choice.id === selectedId,
  );
  const editable = selected?.kind === "scriptsHeader";
  return (
    <Stack direction="row" alignItems="center" padding={0.5} flexShrink={0}>
      <Autocomplete
        size="small"
        fullWidth
        disableClearable={selected != undefined}
        value={selected ?? ReactNull}
        options={choices}
        groupBy={(choice) => (choice.kind === "newScript" ? "" : t(choice.kind))}
        getOptionKey={(choice) =>
          choice.kind === "scriptsHeader" ? `script:${choice.id}` : `${choice.kind}:${choice.label}`
        }
        onChange={(_event, choice) => {
          if (choice == undefined) {
            return;
          }
          switch (choice.kind) {
            case "scriptsHeader":
              selectScript(choice.id);
              break;
            case "utilitiesHeader":
              selectUtility({
                filePath: DEFAULT_STUDIO_SCRIPT_PREFIX + choice.label,
                code: choice.sourceCode,
                readOnly: true,
              });
              break;
            case "templatesHeader":
              addScript(choice.sourceCode, choice.label);
              break;
            case "rotationSetting":
              toggleRotation();
              break;
            case "newScript":
              addScript();
              break;
          }
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={t("selectScript")}
            slotProps={{
              ...params.slotProps,
              htmlInput: { ...params.slotProps.htmlInput, "aria-label": t("selectScript") },
            }}
          />
        )}
      />
      <IconButton
        size="small"
        title={t("rename")}
        aria-label={t("rename")}
        disabled={!editable}
        onClick={async () => {
          const name = await prompt({
            title: t("rename"),
            initialValue: selected?.label,
            label: t("scriptNamePlaceholder"),
          });
          if (name) {
            renameScript(name);
          }
        }}
      >
        <Edit20Regular />
      </IconButton>
      <IconButton
        size="small"
        title={t("delete")}
        aria-label={t("delete")}
        disabled={!editable}
        onClick={async () => {
          if (
            selected &&
            (await confirm({
              title: t("confirmDeleteScript", { name: selected.label }),
              ok: t("delete"),
              cancel: t("cancel"),
              variant: "danger",
            })) === "ok"
          ) {
            deleteScript();
          }
        }}
      >
        <Delete20Regular />
      </IconButton>
      <IconButton
        size="small"
        title={t("autoFormatOnSave")}
        aria-label={t("autoFormatOnSave")}
        aria-pressed={autoFormatOnSave}
        color={autoFormatOnSave ? "primary" : "default"}
        onClick={toggleAutoFormat}
      >
        <AutoFixHighIcon fontSize="small" />
      </IconButton>
      {promptModal}
    </Stack>
  );
}
