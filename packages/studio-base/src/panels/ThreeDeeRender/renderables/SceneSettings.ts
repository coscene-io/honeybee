// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import * as _ from "lodash-es";

import { SettingsTreeAction, SettingsTreeFields } from "@foxglove/studio";

import type { IRenderer } from "../IRenderer";
import { DEFAULT_MESH_UP_AXIS } from "../ModelCache";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";

export const DEFAULT_LABEL_SCALE_FACTOR = 1;
export const DEFAULT_SHOW_SELECTED_OBJECT_LABEL = true;

export class SceneSettings extends SceneExtension {
  public static extensionId = "foxglove.SceneSettings";
  public constructor(renderer: IRenderer, name: string = SceneSettings.extensionId) {
    super(name, renderer);

    this.#handleConfigApplied();
    renderer.on("configApplied", this.#handleConfigApplied);
  }

  public override dispose(): void {
    this.renderer.off("configApplied", this.#handleConfigApplied);
    super.dispose();
  }

  #handleConfigApplied = (): void => {
    const expectedScaleFactor =
      this.renderer.config.scene.labelScaleFactor ?? DEFAULT_LABEL_SCALE_FACTOR;
    if (this.renderer.labelPool.scaleFactor !== expectedScaleFactor) {
      this.renderer.labelPool.setScaleFactor(expectedScaleFactor);
    }
  };

  public override settingsNodes(): SettingsTreeEntry[] {
    const config = this.renderer.config;
    const handler = this.handleSettingsAction;

    const fields: SettingsTreeFields = {
      enableStats: {
        label: t("threeDee:renderStats"),
        input: "boolean",
        value: config.scene.enableStats,
      },
      debugPicking: {
        label: t("threeDee:debugPicking"),
        input: "boolean",
        value: this.renderer.debugPicking,
      },
      backgroundColor: {
        label: t("threeDee:background"),
        input: "rgb",
        value: config.scene.backgroundColor,
      },
      labelScaleFactor: {
        label: t("threeDee:labelScale"),
        help: t("threeDee:labelScaleHelp"),
        input: "number",
        min: 0,
        step: 0.1,
        precision: 2,
        value: config.scene.labelScaleFactor,
        placeholder: String(DEFAULT_LABEL_SCALE_FACTOR),
      },
      showSelectedObjectLabel: {
        label: t("threeDee:showSelectedObjectLabel"),
        help: t("threeDee:showSelectedObjectLabelHelp"),
        input: "boolean",
        value: config.scene.showSelectedObjectLabel ?? DEFAULT_SHOW_SELECTED_OBJECT_LABEL,
      },
      ignoreColladaUpAxis: {
        label: t("threeDee:ignoreColladaUpAxis"),
        help: t("threeDee:ignoreColladaUpAxisHelp"),
        input: "boolean",
        value: config.scene.ignoreColladaUpAxis,
        error:
          (config.scene.ignoreColladaUpAxis ?? false) !==
          this.renderer.modelCache.options.ignoreColladaUpAxis
            ? t("threeDee:takeEffectAfterReboot")
            : undefined,
      },
      meshUpAxis: {
        label: t("threeDee:meshUpAxis"),
        help: t("threeDee:meshUpAxisHelp"),
        input: "select",
        value: config.scene.meshUpAxis ?? DEFAULT_MESH_UP_AXIS,
        options: [
          { label: t("threeDee:YUp"), value: "y_up" },
          { label: t("threeDee:ZUp"), value: "z_up" },
        ],
        error:
          (config.scene.meshUpAxis ?? DEFAULT_MESH_UP_AXIS) !==
          this.renderer.modelCache.options.meshUpAxis
            ? t("threeDee:takeEffectAfterReboot")
            : undefined,
      },
    };

    if (this.renderer.interfaceMode !== "3d") {
      delete fields.showSelectedObjectLabel;
    }
    if (process.env.NODE_ENV === "production") {
      delete fields.debugPicking;
    }
    return [
      {
        path: ["scene"],
        node: {
          label: t("threeDee:scene"),
          actions: [{ type: "action", id: "reset-scene", label: t("threeDee:reset") }],
          fields,
          defaultExpansionState: "collapsed",
          handler,
        },
      },
    ];
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    if (action.action === "perform-node-action" && action.payload.id === "reset-scene") {
      this.renderer.updateConfig((draft) => {
        draft.scene = {};
      });
      this.renderer.setColorScheme(this.renderer.colorScheme, undefined);
      this.updateSettingsTree();
      return;
    }

    if (action.action !== "update" || action.payload.path.length === 0) {
      return;
    }

    const path = action.payload.path;
    const category = path[0]!;
    const value = action.payload.value;
    if (category === "scene") {
      if (path[1] === "debugPicking") {
        this.renderer.debugPicking = (value as boolean | undefined) ?? false;
        this.updateSettingsTree();
        return;
      }
      // Update the configuration
      this.renderer.updateConfig((draft) => _.set(draft, path, value));

      if (path[1] === "backgroundColor") {
        const backgroundColor = value as string | undefined;
        this.renderer.setColorScheme(this.renderer.colorScheme, backgroundColor);
      }
    } else {
      return;
    }

    // Update the settings sidebar
    this.updateSettingsTree();
  };
}
