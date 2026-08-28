// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";
import { produce } from "immer";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useShallowMemo } from "@foxglove/hooks";
import {
  SettingsTreeAction,
  SettingsTreeNode,
  SettingsTreeNodeAction,
  SettingsTreeNodes,
} from "@foxglove/studio";

import { Config, Rule } from "./types";

function ruleToString(rule: Rule): string {
  const operator = {
    "=": "=",
    "<": "<",
    "<=": "≤",
    ">": ">",
    ">=": "≥",
  }[rule.operator];
  return `data ${operator} ${rule.rawValue}`;
}

export function settingsActionReducer(prevConfig: Config, action: SettingsTreeAction): Config {
  return produce(prevConfig, (draft) => {
    switch (action.action) {
      case "perform-node-action":
        if (action.payload.path[0] === "rules") {
          if (action.payload.id === "delete-rule") {
            const ruleIndex = +action.payload.path[1]!;
            draft.rules.splice(ruleIndex, 1);
          } else if (
            action.payload.id === "add-rule" ||
            action.payload.id === "add-rule-above" ||
            action.payload.id === "add-rule-below"
          ) {
            let insertIndex = draft.rules.length;
            if (action.payload.id === "add-rule-above" && action.payload.path[1] !== "default") {
              insertIndex = +action.payload.path[1]!;
            } else if (action.payload.id === "add-rule-below") {
              insertIndex = +action.payload.path[1]! + 1;
            }
            draft.rules.splice(insertIndex, 0, {
              operator: "=",
              rawValue: "true",
              color: `#${Math.floor(Math.random() * 0x1000000).toString(16)}`,
              label: "Label",
            });
          } else if (action.payload.id === "move-up") {
            const ruleIndex = +action.payload.path[1]!;
            const [rule] = draft.rules.splice(ruleIndex, 1);
            draft.rules.splice(ruleIndex - 1, 0, rule!);
          } else if (action.payload.id === "move-down") {
            const ruleIndex = +action.payload.path[1]!;
            const [rule] = draft.rules.splice(ruleIndex, 1);
            draft.rules.splice(ruleIndex + 1, 0, rule!);
          }
        }
        break;
      case "update":
        switch (action.payload.path[0]) {
          case "general":
            _.set(draft, [action.payload.path[1]!], action.payload.value);
            break;
          case "rules":
            if (action.payload.path[1] === "default") {
              _.set(draft, [action.payload.path[2]!], action.payload.value);
            } else {
              const ruleIndex = +action.payload.path[1]!;
              _.set(draft.rules[ruleIndex]!, [action.payload.path[2]!], action.payload.value);
            }
            break;
          default:
            throw new Error(`Unexpected payload.path[0]: ${action.payload.path[0]}`);
        }
        break;
    }
  });
}

const memoizedCreateRuleNode = memoizeWeak(
  (rule: Rule, i: number, rules: readonly Rule[], t: TFunction<"indicator">): SettingsTreeNode => {
    const actions: (SettingsTreeNodeAction | false)[] = [
      { type: "action", id: "delete-rule", label: t("deleteRule"), icon: "Delete" },
      i > 0 && { type: "action", id: "move-up", label: t("moveUp"), icon: "MoveUp" },
      i < rules.length - 1 && {
        type: "action",
        id: "move-down",
        label: t("moveDown"),
        icon: "MoveDown",
      },
      { type: "action", id: "add-rule-above", label: t("addRuleAbove"), icon: "Add" },
      { type: "action", id: "add-rule-below", label: t("addRuleBelow"), icon: "Add" },
    ];
    return {
      label: ruleToString(rule),
      actions: actions.filter((action): action is SettingsTreeNodeAction => action !== false),
      fields: {
        operator: {
          label: t("comparison"),
          input: "select",
          value: rule.operator,
          options: [
            { label: t("equalTo"), value: "=" },
            { label: t("lessThan"), value: "<" },
            { label: t("lessThanOrEqualTo"), value: "<=" },
            { label: t("greaterThan"), value: ">" },
            { label: t("greaterThanOrEqualTo"), value: ">=" },
          ],
        },
        rawValue: {
          label: t("comparisonWith"),
          input: "string",
          value: rule.rawValue,
        },
        color: {
          label: t("color"),
          input: "rgb",
          value: rule.color,
        },
        label: {
          label: t("label"),
          input: "string",
          value: rule.label,
        },
      },
    };
  },
);

export function useSettingsTree(
  config: Config,
  pathParseError: string | undefined,
  error: string | undefined,
): SettingsTreeNodes {
  const { t } = useTranslation("indicator");
  const { path, style, rules } = config;
  const generalSettings: SettingsTreeNode = useMemo(
    () => ({
      error,
      fields: {
        path: {
          label: t("messagePath"),
          input: "messagepath",
          value: path,
          error: pathParseError,
        },
        style: {
          label: t("style"),
          input: "select",
          value: style,
          options: [
            { label: t("bulb"), value: "bulb" },
            { label: t("background"), value: "background" },
          ],
        },
      },
    }),
    [error, path, pathParseError, style, t],
  );

  const { fallbackColor, fallbackLabel } = config;
  const ruleSettings: SettingsTreeNode = useMemo(
    () => ({
      label: t("rules"),
      actions: [{ type: "action", id: "add-rule", label: t("addRule"), icon: "Add" }],
      children: Object.fromEntries(
        rules
          .map((rule, i) => [i.toString(), memoizedCreateRuleNode(rule, i, rules, t)])
          .concat([
            [
              "default",
              {
                label: t("otherwise"),
                fields: {
                  fallbackColor: {
                    label: t("color"),
                    input: "rgb",
                    value: fallbackColor,
                    help: t("fallbackColorHelp"),
                  },
                  fallbackLabel: {
                    label: t("label"),
                    input: "string",
                    value: fallbackLabel,
                    help: t("fallbackLabelHelp"),
                  },
                },
                actions: [
                  { type: "action", id: "add-rule-above", label: t("addRuleAbove"), icon: "Add" },
                ],
              },
            ],
          ]),
      ),
    }),
    [fallbackColor, fallbackLabel, rules, t],
  );

  return useShallowMemo({
    general: generalSettings,
    rules: ruleSettings,
  });
}
