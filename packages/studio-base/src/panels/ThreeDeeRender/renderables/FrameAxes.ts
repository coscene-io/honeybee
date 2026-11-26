// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import * as _ from "lodash-es";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import {
  Immutable,
  SettingsTreeAction,
  SettingsTreeChildren,
  SettingsTreeFields,
} from "@foxglove/studio";
import type { RosValue } from "@foxglove/studio-base/players/types";
import { Label } from "@foxglove/three-text";

import { Axis, AXIS_LENGTH } from "./Axis";
import { DEFAULT_LABEL_SCALE_FACTOR } from "./SceneSettings";
import type { IRenderer, RendererConfig } from "../IRenderer";
import type { PickedRenderable } from "../Picker";
import { BaseUserData, Renderable } from "../Renderable";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { getLuminance, stringToRgb } from "../color";
import {
  acquirePooledLabel,
  applyLabelHighlightStyle,
  DEFAULT_LABEL_ANCHOR_X,
  DEFAULT_LABEL_ANCHOR_Y,
  matchesLabelFilter,
  normalizeLabelFilter,
  releasePooledLabel,
} from "../labels/labelUtils";
import { LabelDensityCuller, LabelVisibilityCandidate } from "../labels/labelVisibility";
import { BaseSettings, fieldSize, PRECISION_DEGREES, PRECISION_DISTANCE } from "../settings";
import { CoordinateFrame, Duration, makePose, MAX_DURATION, Transform } from "../transforms";
import { makeLinePickingMaterial } from "./markers/materials";

export type LayerSettingsTransform = BaseSettings & {
  xyzOffset: Readonly<[number | undefined, number | undefined, number | undefined]>;
  rpyCoefficient: Readonly<[number | undefined, number | undefined, number | undefined]>;
};

const PICKING_LINE_SIZE = 6;
const PI_2 = Math.PI / 2;

const DEFAULT_EDITABLE = false;

const DEFAULT_AXIS_SCALE = 1;
const DEFAULT_LINE_WIDTH_PX = 2;
const DEFAULT_LINE_COLOR_STR = "#ffff00";
export const DEFAULT_TF_LABEL_SIZE = 0.2;
export const DEFAULT_TF_LABEL_SIZE_PX = 14;
const DEFAULT_SCALE_INVARIANT_LABELS = false;
const SCREEN_SPACE_LABEL_OFFSET_MARGIN = 0.05;

const PRIORITY_NORMAL = 0;
const PRIORITY_ACTIVE_FRAME = 1;
const PRIORITY_FILTER_MATCH = 2;
const PRIORITY_SELECTED = 3;

const DEFAULT_SETTINGS: LayerSettingsTransform = {
  visible: true,
  frameLocked: true,
  xyzOffset: [0, 0, 0],
  rpyCoefficient: [0, 0, 0],
};

export type FrameAxisUserData = BaseUserData & {
  axis: Axis;
  label: Label;
  parentLine: Line2;
};

export class FrameAxisRenderable extends Renderable<FrameAxisUserData> {
  public override dispose(): void {
    releasePooledLabel(this.renderer.labelPool, this.userData.label);
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    const frame = this.renderer.transformTree.frame(this.userData.frameId);
    const parent = frame?.parent();
    const fixed = frame?.root();

    return {
      child_frame_id: frame?.displayName() ?? "<unknown>",
      parent_frame_id: parent?.displayName() ?? "<unknown>",
      fixed_frame_id: fixed?.displayName() ?? "<unknown>",
    };
  }
}

const tempVec = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempVecC = new THREE.Vector3();
const tempLower: [Duration, Transform] = [0n, Transform.Identity()];
const tempUpper: [Duration, Transform] = [0n, Transform.Identity()];
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempTfPath: [string, string] = ["transforms", ""];

export class FrameAxes extends SceneExtension<FrameAxisRenderable> {
  public static extensionId = "foxglove.FrameAxes";
  #lineMaterial: LineMaterial;
  #linePickingMaterial: THREE.ShaderMaterial;

  #colorScheme: "dark" | "light" = "light";
  #labelForegroundColor = 1;
  #labelBackgroundColor = new THREE.Color();
  #lineGeometry: LineGeometry;
  #defaultRenderableSettings: LayerSettingsTransform;
  #selectedFrameId: string | undefined;
  #lastScaleInvariantLabels: boolean;
  #lastLabelSize: number | undefined;
  #lastNormalizedFilter: string;
  #labelCuller = new LabelDensityCuller();
  #candidatePool: LabelVisibilityCandidate[] = [];
  #activeCandidates: LabelVisibilityCandidate[] = [];
  #activeCandidateRenderables: FrameAxisRenderable[] = [];
  #lastLabelVisibility = new Map<string, boolean>();

  public constructor(
    renderer: IRenderer,
    defaultRenderableSettings: Partial<LayerSettingsTransform>,
    name: string = FrameAxes.extensionId,
  ) {
    super(name, renderer);

    const linewidth = this.renderer.config.scene.transforms?.lineWidth ?? DEFAULT_LINE_WIDTH_PX;
    const color = stringToRgb(
      new THREE.Color(),
      this.renderer.config.scene.transforms?.lineColor ?? DEFAULT_LINE_COLOR_STR,
    );
    this.#lineMaterial = new LineMaterial({ linewidth });
    this.#lineMaterial.color = color;

    const options = { resolution: renderer.input.canvasSize, worldUnits: false };

    this.#lineGeometry = this.renderer.sharedGeometry.getGeometry(
      this.constructor.name,
      createLineGeometry,
    );

    this.#linePickingMaterial = makeLinePickingMaterial(PICKING_LINE_SIZE, options);
    this.#colorScheme = renderer.colorScheme;
    this.#lastScaleInvariantLabels =
      renderer.config.scene.transforms?.scaleInvariantLabels ?? DEFAULT_SCALE_INVARIANT_LABELS;
    this.#lastLabelSize = renderer.config.scene.transforms?.labelSize;
    this.#lastNormalizedFilter = normalizeLabelFilter(
      renderer.config.scene.transforms?.labelFilter,
    );

    renderer.on("transformTreeUpdated", this.#handleTransformTreeUpdated);
    renderer.on("selectedRenderable", this.#handleSelectedRenderable);
    renderer.on("configApplied", this.#handleConfigApplied);

    this.#defaultRenderableSettings = { ...DEFAULT_SETTINGS, ...defaultRenderableSettings };
  }

  public override dispose(): void {
    this.renderer.off("transformTreeUpdated", this.#handleTransformTreeUpdated);
    this.renderer.off("selectedRenderable", this.#handleSelectedRenderable);
    this.renderer.off("configApplied", this.#handleConfigApplied);
    // Cancel the throttled function to prevent memory leaks
    this.#throttledUpdateSettingsTree.cancel();
    this.#lineMaterial.dispose();
    this.#linePickingMaterial.dispose();
    this.#lastLabelVisibility.clear();
    super.dispose();
  }

  public override removeAllRenderables(): void {
    // Don't destroy frame axis renderables on clear() since `renderer.transformTree`
    // is left untouched
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const config = this.renderer.config;
    const configTransforms = config.transforms;
    const handler = this.handleSettingsAction;
    const frameCount = this.renderer.coordinateFrameList.length;
    const showLabel = config.scene.transforms?.showLabel ?? true;
    const scaleInvariantLabels =
      config.scene.transforms?.scaleInvariantLabels ?? DEFAULT_SCALE_INVARIANT_LABELS;
    const children: SettingsTreeChildren = {
      settings: {
        label: t("threeDee:settings"),
        defaultExpansionState: "collapsed",
        order: 0,
        fields: {
          editable: {
            label: t("threeDee:editable"),
            input: "boolean",
            value: config.scene.transforms?.editable ?? DEFAULT_EDITABLE,
          },
          showLabel: {
            label: t("threeDee:labels"),
            input: "boolean",
            value: showLabel,
          },
          ...(showLabel && {
            scaleInvariantLabels: {
              label: t("threeDee:scaleInvariantLabels"),
              help: t("threeDee:scaleInvariantLabelsHelp"),
              input: "boolean",
              value: scaleInvariantLabels,
            },
            labelSize: {
              label: t("threeDee:labelSize"),
              input: "number",
              min: 0,
              step: scaleInvariantLabels ? 1 : 0.01,
              precision: scaleInvariantLabels ? 0 : 2,
              placeholder: String(
                scaleInvariantLabels ? DEFAULT_TF_LABEL_SIZE_PX : DEFAULT_TF_LABEL_SIZE,
              ),
              value: config.scene.transforms?.labelSize,
            },
            labelMaxDistance: {
              label: t("threeDee:labelMaxDistance"),
              help: t("threeDee:labelMaxDistanceHelp"),
              input: "number",
              min: 0,
              step: 1,
              precision: 1,
              placeholder: "0",
              value: config.scene.transforms?.labelMaxDistance,
            },
            labelMinSpacing: {
              label: t("threeDee:labelMinSpacing"),
              help: t("threeDee:labelMinSpacingHelp"),
              input: "number",
              min: 0,
              step: 5,
              precision: 0,
              placeholder: "0",
              value: config.scene.transforms?.labelMinSpacing,
            },
            labelFilter: {
              label: t("threeDee:labelHighlightFilter"),
              help: t("threeDee:labelHighlightFilterHelp"),
              input: "string",
              placeholder: "base_link",
              value: config.scene.transforms?.labelFilter,
            },
          }),
          axisScale: fieldSize(
            t("threeDee:axisScale"),
            config.scene.transforms?.axisScale,
            DEFAULT_AXIS_SCALE,
          ),
          lineWidth: {
            label: t("threeDee:lineWidth"),
            input: "number",
            min: 0,
            step: 0.5,
            precision: 1,
            value: config.scene.transforms?.lineWidth,
            placeholder: String(DEFAULT_LINE_WIDTH_PX),
          },
          lineColor: {
            label: t("threeDee:lineColor"),
            input: "rgb",
            value: config.scene.transforms?.lineColor ?? DEFAULT_LINE_COLOR_STR,
          },
          enablePreloading: {
            label: t("threeDee:enablePreloading"),
            input: "boolean",
            value: config.scene.transforms?.enablePreloading ?? true,
          },
        },
      },
    };

    let order = 1;
    for (const { label, value: frameId } of this.renderer.coordinateFrameList) {
      const frameKey = `frame:${frameId}`;
      const tfConfig = this.#getRenderableSettingsWithDefaults(configTransforms[frameKey] ?? {});
      const frame = this.renderer.transformTree.frame(frameId);
      const fields = buildSettingsFields(frame, this.renderer.currentTime, config);
      tempTfPath[1] = frameKey;
      children[frameKey] = {
        label,
        fields,
        visible: tfConfig.visible,
        order: order++,
        defaultExpansionState: "collapsed",
        error: this.renderer.settings.errors.errors.errorAtPath(tempTfPath),
      };
    }

    return [
      {
        path: ["transforms"],
        node: {
          label: `${t("threeDee:transforms")}${frameCount > 0 ? ` (${frameCount})` : ""}`,
          actions: [
            { id: "show-all", type: "action", label: t("threeDee:showAll") },
            { id: "hide-all", type: "action", label: t("threeDee:hideAll") },
          ],
          handler,
          children,
        },
      },
    ];
  }

  #throttledUpdateSettingsTree = _.throttle(() => {
    this.updateSettingsTree();
    /**
     * Chose .5s because it gives better performance than .1s and doesn't feel sluggish.
     * This doesn't conform to our principles around response times but I believe performance
     * is a bigger issue here than responsiveness. The longer time between updates also gives users
     * a chance read the numbers more clearly, though I don't think that's a big use case here.
     */
  }, 500);

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    // Keep the material's `resolution` uniform in sync with the actual canvas size
    this.#lineMaterial.resolution = this.renderer.input.canvasSize;

    // Update all the transforms settings nodes each frame since they contain
    // fields that change when currentTime changes
    this.#throttledUpdateSettingsTree();
    // this.updateSettingsTree();

    super.startFrame(currentTime, renderFrameId, fixedFrameId);

    const transformsConfig = this.renderer.config.scene.transforms;
    const showLabel = transformsConfig?.showLabel ?? true;
    const scaleInvariant = transformsConfig?.scaleInvariantLabels ?? DEFAULT_SCALE_INVARIANT_LABELS;
    const axisScale = transformsConfig?.axisScale ?? DEFAULT_AXIS_SCALE;
    const axisLength = AXIS_LENGTH * axisScale;
    const labelSize =
      transformsConfig?.labelSize ??
      (scaleInvariant ? DEFAULT_TF_LABEL_SIZE_PX : DEFAULT_TF_LABEL_SIZE);
    const labelScale = this.renderer.config.scene.labelScaleFactor ?? DEFAULT_LABEL_SCALE_FACTOR;
    // In screen-space mode, anchor the label bottom-center slightly above the axis tip so its
    // pixel height stays glued cleanly above the arrow across zoom/rotate/resize.
    const labelOffsetZ = scaleInvariant
      ? axisLength + SCREEN_SPACE_LABEL_OFFSET_MARGIN * axisScale
      : axisLength + labelSize * labelScale * 1.5;

    const maxDistance = transformsConfig?.labelMaxDistance;
    const minSpacingPx = transformsConfig?.labelMinSpacing;
    const normalizedFilter = this.#lastNormalizedFilter;
    const shouldCullLabels =
      showLabel &&
      ((maxDistance != undefined && maxDistance > 0) ||
        (minSpacingPx != undefined && minSpacingPx > 0));

    let candidateCount = 0;

    // Update the lines and labels between coordinate frames
    for (const renderable of this.renderables.values()) {
      // lines and labels are children of the renderable and won't render if the renderable isn't visible
      // so we can skip these updates
      if (!renderable.visible) {
        continue;
      }
      const line = renderable.userData.parentLine;
      const childFrame = this.renderer.transformTree.frame(renderable.userData.frameId);
      const parentFrame = childFrame?.parent();
      // NOTE: tempVecB should not be used until the label uses it below
      const worldPosition = tempVecB;
      renderable.getWorldPosition(worldPosition);
      // Lines require a parent renderable because they draw a line from the parent
      // frame origin to the child frame origin
      line.visible = false;
      if (parentFrame) {
        const parentRenderable = this.renderables.get(parentFrame.id);
        if (parentRenderable?.visible === true) {
          const parentWorldPosition = tempVec;
          parentRenderable.getWorldPosition(parentWorldPosition);
          const dist = parentWorldPosition.distanceTo(worldPosition);
          line.lookAt(parentWorldPosition);
          line.rotateY(-PI_2);
          line.scale.set(dist, 1, 1);
          line.visible = true;
        }
      }

      const label = renderable.userData.label;
      if (!showLabel) {
        label.visible = false;
        continue;
      }

      // Add the label offset in "world" coordinates (in the render frame)
      worldPosition.z += labelOffsetZ;
      // Transform worldPosition back to the local coordinate frame of the
      // renderable, which the label is a child of
      tempVecC.copy(worldPosition);
      renderable.worldToLocal(tempVecC);
      label.position.set(tempVecC.x, tempVecC.y, tempVecC.z);

      if (!shouldCullLabels) {
        label.visible = true;
        continue;
      }

      const frameId = renderable.userData.frameId;
      const displayName = childFrame?.displayName() ?? frameId;
      const isSelected = frameId === this.#selectedFrameId;
      const isFilterMatch = matchesLabelFilter(displayName, normalizedFilter);
      const priority = isSelected
        ? PRIORITY_SELECTED
        : isFilterMatch
          ? PRIORITY_FILTER_MATCH
          : frameId === renderFrameId || frameId === fixedFrameId
            ? PRIORITY_ACTIVE_FRAME
            : PRIORITY_NORMAL;

      let candidate = this.#candidatePool[candidateCount];
      if (!candidate) {
        candidate = {
          id: frameId,
          worldPosition: new THREE.Vector3(),
          priority,
          alwaysVisible: false,
          wasVisible: true,
          visible: true,
        };
        this.#candidatePool.push(candidate);
      }
      candidate.id = frameId;
      candidate.worldPosition.copy(worldPosition);
      candidate.priority = priority;
      candidate.alwaysVisible = isSelected || isFilterMatch;
      candidate.wasVisible = this.#lastLabelVisibility.get(frameId) ?? true;
      candidate.visible = true;

      this.#activeCandidates[candidateCount] = candidate;
      this.#activeCandidateRenderables[candidateCount] = renderable;
      candidateCount++;
    }

    if (shouldCullLabels) {
      this.#activeCandidates.length = candidateCount;
      this.#activeCandidateRenderables.length = candidateCount;

      if (candidateCount > 0) {
        this.#labelCuller.evaluate(this.#activeCandidates, {
          camera: this.renderer.cameraHandler.getActiveCamera(),
          canvasWidth: this.renderer.input.canvasSize.width,
          canvasHeight: this.renderer.input.canvasSize.height,
          maxDistance,
          minSpacingPx,
        });

        for (let i = 0; i < candidateCount; i++) {
          const candidate = this.#activeCandidates[i]!;
          const renderable = this.#activeCandidateRenderables[i]!;
          renderable.userData.label.visible = candidate.visible;
          this.#lastLabelVisibility.set(candidate.id, candidate.visible);
        }
      }
    }
  }

  public override setColorScheme(
    colorScheme: "dark" | "light",
    backgroundColor: THREE.Color | undefined,
  ): void {
    this.#colorScheme = colorScheme;
    const foreground = colorScheme === "dark" ? 1 : 0;
    this.#labelForegroundColor = foreground;
    this.#labelBackgroundColor.setRGB(1 - foreground, 1 - foreground, 1 - foreground);
    if (backgroundColor) {
      this.#labelForegroundColor =
        getLuminance(backgroundColor.r, backgroundColor.g, backgroundColor.b) > 0.5 ? 0 : 1;
      this.#labelBackgroundColor.copy(backgroundColor);
    }

    this.#updateAllLabelStyles();
  }

  #applyLabelSizing(label: Label): void {
    const transformsConfig = this.renderer.config.scene.transforms;
    const scaleInvariant = transformsConfig?.scaleInvariantLabels ?? DEFAULT_SCALE_INVARIANT_LABELS;
    const labelSize =
      transformsConfig?.labelSize ??
      (scaleInvariant ? DEFAULT_TF_LABEL_SIZE_PX : DEFAULT_TF_LABEL_SIZE);

    label.setBillboard(true);
    label.setSizeAttenuation(!scaleInvariant);
    label.setAnchorPoint(DEFAULT_LABEL_ANCHOR_X, scaleInvariant ? 0 : DEFAULT_LABEL_ANCHOR_Y);
    label.setLineHeight(labelSize);
  }

  #updateAllLabelSizing(): void {
    for (const renderable of this.renderables.values()) {
      this.#applyLabelSizing(renderable.userData.label);
    }
  }

  #applyLabelStyle(renderable: FrameAxisRenderable): void {
    const frameId = renderable.userData.frameId;
    const frame = this.renderer.transformTree.frame(frameId);
    const displayName = frame?.displayName() ?? frameId;
    const normalizedFilter = normalizeLabelFilter(
      this.renderer.config.scene.transforms?.labelFilter,
    );
    const highlighted =
      frameId === this.#selectedFrameId || matchesLabelFilter(displayName, normalizedFilter);

    applyLabelHighlightStyle(renderable.userData.label, {
      highlighted,
      colorScheme: this.#colorScheme,
      normalForeground: this.#labelForegroundColor,
      normalBackground: this.#labelBackgroundColor,
    });
  }

  #updateAllLabelStyles(): void {
    for (const renderable of this.renderables.values()) {
      this.#applyLabelStyle(renderable);
    }
  }

  #handleSelectedRenderable = (selection: PickedRenderable | undefined): void => {
    const nextSelectedFrameId =
      selection?.renderable instanceof FrameAxisRenderable
        ? selection.renderable.userData.frameId
        : undefined;
    if (nextSelectedFrameId === this.#selectedFrameId) {
      return;
    }

    const prevFrameId = this.#selectedFrameId;
    this.#selectedFrameId = nextSelectedFrameId;

    if (prevFrameId != undefined) {
      const prevRenderable = this.renderables.get(prevFrameId);
      if (prevRenderable) {
        this.#applyLabelStyle(prevRenderable);
      }
    }
    if (nextSelectedFrameId != undefined) {
      const nextRenderable = this.renderables.get(nextSelectedFrameId);
      if (nextRenderable) {
        this.#applyLabelStyle(nextRenderable);
      }
    }
  };

  #handleConfigApplied = (): void => {
    const transformsConfig = this.renderer.config.scene.transforms;
    const scaleInvariant = transformsConfig?.scaleInvariantLabels ?? DEFAULT_SCALE_INVARIANT_LABELS;
    const labelSize = transformsConfig?.labelSize;
    const normalizedFilter = normalizeLabelFilter(transformsConfig?.labelFilter);

    if (scaleInvariant !== this.#lastScaleInvariantLabels || labelSize !== this.#lastLabelSize) {
      this.#lastScaleInvariantLabels = scaleInvariant;
      this.#lastLabelSize = labelSize;
      this.#updateAllLabelSizing();
    }

    if (normalizedFilter !== this.#lastNormalizedFilter) {
      this.#lastNormalizedFilter = normalizedFilter;
      this.#updateAllLabelStyles();
    }
  };

  #setAxisScale(scale: number): void {
    for (const renderable of this.renderables.values()) {
      renderable.userData.axis.scale.set(scale, scale, scale);
    }
  }

  #setLineWidth(width: number): void {
    this.#lineMaterial.linewidth = width;
  }

  #setLineColor(color: string): void {
    stringToRgb(this.#lineMaterial.color, color);
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    // eslint-disable-next-line @coscene-io/no-boolean-parameters
    const toggleFrameVisibility = (value: boolean) => {
      for (const renderable of this.renderables.values()) {
        renderable.userData.settings.visible = value;
      }

      this.renderer.updateConfig((draft) => {
        for (const frameId of this.renderables.keys()) {
          const frameKeySanitized = frameId === "settings" ? "$settings" : `frame:${frameId}`;
          const transformSettings = (draft.transforms[frameKeySanitized] ??= {});
          transformSettings.visible = value;
        }
      });

      this.updateSettingsTree();
    };

    if (action.action === "perform-node-action") {
      if (action.payload.id === "show-all") {
        // Show all frames
        toggleFrameVisibility(true);
      } else if (action.payload.id === "hide-all") {
        // Hide all frames
        toggleFrameVisibility(false);
      }
      return;
    }

    if (path.length !== 3) {
      return; // Doesn't match the pattern of ["transforms", "settings" | `frame:${frameId}`, field]
    }

    if (path[1] === "settings") {
      const setting = path[2]!;
      const value = action.payload.value;

      if (setting === "scaleInvariantLabels") {
        // Reset labelSize when switching between world-space (meters) and screen-space (pixels)
        // so the unit default stays readable immediately.
        this.renderer.updateConfig((draft) => {
          draft.scene.transforms ??= {};
          draft.scene.transforms.scaleInvariantLabels = value as boolean | undefined;
          draft.scene.transforms.labelSize = undefined;
        });
        this.updateSettingsTree();
        return;
      }

      this.saveSetting(["scene", "transforms", setting], value);

      if (setting === "editable") {
        this.#updateFrameAxes();
      } else if (setting === "axisScale") {
        const axisScale = value as number | undefined;
        this.#setAxisScale(axisScale ?? DEFAULT_AXIS_SCALE);
      } else if (setting === "lineWidth") {
        const lineWidth = value as number | undefined;
        this.#setLineWidth(lineWidth ?? DEFAULT_LINE_WIDTH_PX);
      } else if (setting === "lineColor") {
        const lineColor = value as string | undefined;
        this.#setLineColor(lineColor ?? DEFAULT_LINE_COLOR_STR);
      }
    } else {
      this.saveSetting(path, action.payload.value);

      // Update the renderable
      const frameKey = path[1]!;
      const frameId = frameKey.replace(/^frame:/, "");
      const renderable = this.renderables.get(frameId);
      if (renderable) {
        const settings = this.renderer.config.transforms[frameKey];
        renderable.userData.settings = this.#getRenderableSettingsWithDefaults(settings ?? {});

        this.#updateFrameAxis(renderable);
      }
    }
  };

  #getRenderableSettingsWithDefaults(
    partialDefinedSettings: Partial<LayerSettingsTransform>,
  ): LayerSettingsTransform {
    return { ...this.#defaultRenderableSettings, ...partialDefinedSettings };
  }

  #handleTransformTreeUpdated = (): void => {
    for (const frameId of this.renderer.transformTree.frames().keys()) {
      this.#addFrameAxis(frameId);
    }
    const config = this.renderer.config;
    if (config.scene.transforms?.editable === true) {
      this.#updateFrameAxes();
    }
    this.updateSettingsTree();
  };

  #addFrameAxis(frameId: string): void {
    if (this.renderables.has(frameId)) {
      return;
    }

    const config = this.renderer.config;
    const frame = this.renderer.transformTree.frame(frameId);
    if (!frame) {
      throw new Error(`CoordinateFrame "${frameId}" was not created`);
    }

    // Text label
    const text = frame.displayName();
    const label = acquirePooledLabel(this.renderer.labelPool);
    label.setText(text);
    this.#applyLabelSizing(label);

    // Set the initial settings from default values merged with any user settings
    const frameKey = `frame:${frameId}`;
    const userSettings = config.transforms[frameKey];
    const settings = this.#getRenderableSettingsWithDefaults(userSettings ?? {});

    // Parent line
    const parentLine = new Line2(this.#lineGeometry, this.#lineMaterial);
    parentLine.castShadow = true;
    parentLine.receiveShadow = false;
    parentLine.userData.pickingMaterial = this.#linePickingMaterial;

    // Three arrow axis
    const axis = new Axis(frameId, this.renderer);
    const axisScale = config.scene.transforms?.axisScale ?? DEFAULT_AXIS_SCALE;
    axis.scale.set(axisScale, axisScale, axisScale);

    // Create a scene graph object to hold the axis, a text label, and a line to
    // the parent frame
    const renderable = new FrameAxisRenderable(frameId, this.renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId,
      pose: makePose(),
      settingsPath: ["transforms", frameKey],
      settings,
      axis,
      label,
      parentLine,
    });
    renderable.add(axis);
    renderable.add(label);
    renderable.add(parentLine);

    this.#applyLabelStyle(renderable);

    this.add(renderable);
    this.renderables.set(frameId, renderable);

    this.#updateFrameAxis(renderable);
  }

  #updateFrameAxes(): void {
    for (const renderable of this.renderables.values()) {
      this.#updateFrameAxis(renderable);
    }
  }

  #updateFrameAxis(renderable: FrameAxisRenderable): void {
    const frame = this.renderer.transformTree.getOrCreateFrame(renderable.userData.frameId);

    // Check if TF editing is disabled
    const editable = this.renderer.config.scene.transforms?.editable ?? DEFAULT_EDITABLE;
    if (!editable) {
      frame.offsetPosition = undefined;
      frame.offsetEulerDegrees = undefined;
      return;
    }

    const frameKey = `frame:${renderable.userData.frameId}`;
    frame.offsetPosition = getOffset(this.renderer.config.transforms[frameKey]?.xyzOffset);
    frame.offsetEulerDegrees = getOffset(this.renderer.config.transforms[frameKey]?.rpyCoefficient);
  }
}
function createLineGeometry(): LineGeometry {
  const lineGeometry = new LineGeometry();
  lineGeometry.setPositions([0, 0, 0, 1, 0, 0]);
  return lineGeometry;
}

function buildSettingsFields(
  frame: CoordinateFrame | undefined,
  currentTime: bigint | undefined,
  config: Immutable<RendererConfig>,
): SettingsTreeFields {
  const frameKey = frame ? `frame:${frame.id}` : "";
  const parentFrameId = frame?.parent()?.id;

  if (parentFrameId == undefined) {
    return {
      parent: { label: t("threeDee:parent"), input: "string", readonly: true, value: "<root>" },
    };
  }

  const historySizeValue = String(frame?.transformsSize() ?? 0);
  let ageValue: string | undefined;
  let xyzValue: THREE.Vector3Tuple | undefined;
  let rpyValue: THREE.Vector3Tuple | undefined;

  if (currentTime != undefined && frame) {
    if (frame.findClosestTransforms(tempLower, tempUpper, currentTime, MAX_DURATION)) {
      const [transformTime, transform] = tempUpper;
      ageValue =
        transformTime < currentTime ? formatShortDuration(currentTime - transformTime) : "0 ns";
      const p = transform.position() as THREE.Vector3Tuple;
      const q = transform.rotation() as THREE.Vector4Tuple;
      xyzValue = [round(p[0], 3), round(p[1], 3), round(p[2], 3)];
      tempQuaternion.set(q[0], q[1], q[2], q[3]);
      tempEuler.setFromQuaternion(tempQuaternion, "XYZ");
      rpyValue = [
        round(THREE.MathUtils.radToDeg(tempEuler.x), 3),
        round(THREE.MathUtils.radToDeg(tempEuler.y), 3),
        round(THREE.MathUtils.radToDeg(tempEuler.z), 3),
      ];
    }
  }

  const fields: SettingsTreeFields = {
    parent: {
      label: t("threeDee:parent"),
      input: "string",
      readonly: true,
      value: parentFrameId,
    },
    age: {
      label: t("threeDee:age"),
      input: "string",
      readonly: true,
      value: ageValue,
    },
    historySize: {
      label: t("threeDee:historySize"),
      input: "string",
      readonly: true,
      value: historySizeValue,
    },
    xyz: {
      label: t("threeDee:translation"),
      input: "vec3",
      precision: PRECISION_DISTANCE,
      labels: ["X", "Y", "Z"],
      readonly: true,
      value: xyzValue,
    },
    rpy: {
      label: t("threeDee:rotation"),
      input: "vec3",
      precision: PRECISION_DEGREES,
      labels: ["R", "P", "Y"],
      readonly: true,
      value: rpyValue,
    },
  };

  if (config.scene.transforms?.editable ?? DEFAULT_EDITABLE) {
    let xyzOffsetValue = config.transforms[frameKey]?.xyzOffset as THREE.Vector3Tuple | undefined;
    let rpyCoefficient = config.transforms[frameKey]?.rpyCoefficient as
      THREE.Vector3Tuple | undefined;

    if (xyzOffsetValue && vec3IsZero(xyzOffsetValue)) {
      xyzOffsetValue = undefined;
    }
    if (rpyCoefficient && vec3IsZero(rpyCoefficient)) {
      rpyCoefficient = undefined;
    }

    fields.xyzOffset = {
      label: t("threeDee:translationOffset"),
      input: "vec3",
      precision: PRECISION_DISTANCE,
      step: 0.1,
      labels: ["X", "Y", "Z"],
      value: xyzOffsetValue,
    };
    fields.rpyCoefficient = {
      label: t("threeDee:rotationOffset"),
      input: "vec3",
      precision: PRECISION_DEGREES,
      step: 1,
      min: -180,
      max: 180,
      labels: ["R", "P", "Y"],
      value: rpyCoefficient,
    };
  }

  return fields;
}

const MS_TENTH_NS = BigInt(1e5);
const MS_NS = BigInt(1e6);
const SEC_NS = BigInt(1e9);
const MIN_NS = BigInt(6e10);
const HOUR_NS = BigInt(3.6e12);

function formatShortDuration(duration: Duration): string {
  const absDuration = abs(duration);
  if (absDuration < MS_TENTH_NS) {
    return `${duration} ns`;
  } else if (absDuration < SEC_NS) {
    return `${Number(duration / MS_NS).toFixed(1)} ms`;
  } else if (absDuration < MIN_NS) {
    return `${Number(duration / SEC_NS).toFixed(1)} s`;
  } else if (absDuration < HOUR_NS) {
    return `${Number(duration / MIN_NS).toFixed(1)} min`;
  } else {
    return `${Number(duration / HOUR_NS).toFixed(1)} hr`;
  }
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function round(x: number, precision: number): number {
  return Number(x.toFixed(precision));
}

function vec3IsZero(v: THREE.Vector3Tuple, eps = 1e-6): boolean {
  return Math.abs(v[0]) < eps && Math.abs(v[1]) < eps && Math.abs(v[2]) < eps;
}

function getOffset(
  maybeOffset: Readonly<[number | undefined, number | undefined, number | undefined]> | undefined,
): THREE.Vector3Tuple | undefined {
  if (!maybeOffset) {
    return undefined;
  }
  const [x = 0, y = 0, z = 0] = maybeOffset;
  if (x === 0 && y === 0 && z === 0) {
    return undefined;
  }
  return [x, y, z];
}
