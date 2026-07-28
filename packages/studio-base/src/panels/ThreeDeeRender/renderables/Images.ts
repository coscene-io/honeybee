// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import { assert } from "ts-essentials";

import { MultiMap, filterMap } from "@foxglove/den/collection";
import { PinholeCameraModel } from "@foxglove/den/image";
import Logger from "@foxglove/log";
import { toNanoSec } from "@foxglove/rostime";
import { CameraCalibration, CompressedImage, RawImage } from "@foxglove/schemas";
import { MessageEvent, SettingsTreeAction, SettingsTreeFields } from "@foxglove/studio";
import {
  ALL_SUPPORTED_IMAGE_SCHEMAS,
  SEEK_KEYFRAME_SEARCH_HUD_ITEM,
} from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/ImageMode/constants";

import {
  CompressedVideoController,
  type CompressedVideoDisplayFrames,
  type SeekKeyframeSearchState,
} from "./Images/CompressedVideoController";
import { ALL_CAMERA_INFO_SCHEMAS, AnyImage, CompressedVideo } from "./Images/ImageTypes";
import {
  normalizeCompressedImage,
  normalizeCompressedVideo,
  normalizeRawImage,
  normalizeRosCompressedImage,
  normalizeRosImage,
} from "./Images/imageNormalizers";
import { getTopicMatchPrefix, sortPrefixMatchesToFront } from "./Images/topicPrefixMatching";
import { recordKeyframesAndFilterCompressedVideoQueue } from "./Images/videoMessageQueue";
import { cameraInfosEqual, normalizeCameraInfo } from "./projections";
import type { AnyRendererSubscription, IRenderer } from "../IRenderer";
import {
  PartialMessageEvent,
  SceneExtension,
  type RemoveAllRenderablesOptions,
  onlyLastByTopicMessage,
} from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import {
  CAMERA_CALIBRATION_DATATYPES,
  COMPRESSED_IMAGE_DATATYPES,
  COMPRESSED_VIDEO_DATATYPES,
  RAW_IMAGE_DATATYPES,
} from "../foxglove";
import {
  CameraInfo,
  Image as RosImage,
  CompressedImage as RosCompressedImage,
  IMAGE_DATATYPES as ROS_IMAGE_DATATYPES,
  COMPRESSED_IMAGE_DATATYPES as ROS_COMPRESSED_IMAGE_DATATYPES,
  CAMERA_INFO_DATATYPES,
} from "../ros";
import { BaseSettings, PRECISION_DISTANCE } from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose } from "../transforms";
import {
  IMAGE_RENDERABLE_DEFAULT_SETTINGS,
  ImageRenderable,
  ImageSetImageResult,
  ImageUserData,
} from "./Images/ImageRenderable";

const log = Logger.getLogger(__filename);
void log;

export type LayerSettingsImage = BaseSettings & {
  cameraInfoTopic: string | undefined;
  distance: number;
  planarProjectionFactor: number;
  color: string;
};

const DEFAULT_BITMAP_WIDTH = 512;
const NO_CAMERA_INFO_ERR = "NoCameraInfo";
const CAMERA_MODEL = "CameraModel";

export class Images extends SceneExtension<ImageRenderable> {
  public static extensionId = "foxglove.Images";
  /* All known camera info topics */
  #cameraInfoTopics = new Set<string>();

  /**
   * A bi-directional mapping between cameraInfo topics and image topics. This
   * is used for retrieving an image renderable, which is indexed by image
   * topic, when receiving a camera info message.
   */
  #cameraInfoToImageTopics = new MultiMap<string, string>();

  /**
   * Map of camera info topic name -> normalized CameraInfo message
   *
   * This stores the last camera info message on each topic so it can be applied when rendering the image
   */
  #cameraInfoByTopic = new Map<string, CameraInfo>();
  #compressedVideoControllers = new Map<string, CompressedVideoController>();

  protected supportedImageSchemas = ALL_SUPPORTED_IMAGE_SCHEMAS;

  public constructor(renderer: IRenderer, name: string = Images.extensionId) {
    super(name, renderer);
    this.renderer.on("topicsChanged", this.#handleTopicsChanged);
    this.#handleTopicsChanged();
  }

  public override dispose(): void {
    this.renderer.off("topicsChanged", this.#handleTopicsChanged);
    for (const controller of this.#compressedVideoControllers.values()) {
      controller.dispose();
    }
    this.#compressedVideoControllers.clear();
    this.hud.removeHUDItem(SEEK_KEYFRAME_SEARCH_HUD_ITEM.id);
    super.dispose();
  }

  public override removeAllRenderables(options: RemoveAllRenderablesOptions = {}): void {
    if (options.reason !== "seek") {
      super.removeAllRenderables(options);
      return;
    }

    const preservedTopics = this.#visibleCompressedVideoTopics();
    for (const [topic, renderable] of this.renderables) {
      if (preservedTopics.has(topic)) {
        continue;
      }
      renderable.dispose();
      this.remove(renderable);
      this.renderables.delete(topic);
    }
    this.updateSettingsTree();
  }

  public override handleSeek(): void {
    for (const topic of this.#visibleCompressedVideoTopics()) {
      this.#compressedVideoControllerForTopic(topic).handleSeek({
        resizeWidth: DEFAULT_BITMAP_WIDTH,
      });
    }
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: ALL_CAMERA_INFO_SCHEMAS,
        subscription: {
          handler: this.#handleCameraInfo,
          shouldSubscribe: this.#cameraInfoShouldSubscribe,
        },
      },
      {
        type: "schema",
        schemaNames: ROS_IMAGE_DATATYPES,
        subscription: { handler: this.#handleRosRawImage, filterQueue: onlyLastByTopicMessage },
      },
      {
        type: "schema",
        schemaNames: ROS_COMPRESSED_IMAGE_DATATYPES,
        subscription: {
          handler: this.#handleRosCompressedImage,
          filterQueue: onlyLastByTopicMessage,
        },
      },
      {
        type: "schema",
        schemaNames: RAW_IMAGE_DATATYPES,
        subscription: {
          handler: this.#handleRawImage,
          filterQueue: onlyLastByTopicMessage,
        },
      },
      {
        type: "schema",
        schemaNames: COMPRESSED_IMAGE_DATATYPES,
        subscription: {
          handler: this.#handleCompressedImage,
          filterQueue: onlyLastByTopicMessage,
        },
      },
      {
        type: "schema",
        schemaNames: COMPRESSED_VIDEO_DATATYPES,
        subscription: {
          handler: this.#handleCompressedVideo,
          filterQueue: this.#filterCompressedVideoQueue,
        },
      },
    ];
  }

  /**
   * Update cameraInfoTopics cache with latest set of camera info messages
   */
  #handleTopicsChanged = () => {
    this.#cameraInfoTopics = new Set();
    const compressedVideoTopics = new Set<string>();
    for (const topic of this.renderer.topics ?? []) {
      if (topicIsConvertibleToSchema(topic, COMPRESSED_VIDEO_DATATYPES)) {
        compressedVideoTopics.add(topic.name);
      }
      if (
        topicIsConvertibleToSchema(topic, CAMERA_INFO_DATATYPES) ||
        topicIsConvertibleToSchema(topic, CAMERA_CALIBRATION_DATATYPES)
      ) {
        this.#cameraInfoTopics.add(topic.name);
      }
    }
    for (const [topic, controller] of this.#compressedVideoControllers) {
      if (!compressedVideoTopics.has(topic)) {
        controller.dispose();
        this.#compressedVideoControllers.delete(topic);
      }
    }
  };

  #visibleCompressedVideoTopics(): Set<string> {
    const topics = new Set<string>();
    for (const topic of this.renderer.topics ?? []) {
      if (!topicIsConvertibleToSchema(topic, COMPRESSED_VIDEO_DATATYPES)) {
        continue;
      }
      const settings: Partial<LayerSettingsImage> | undefined =
        this.renderer.config.topics[topic.name];
      if (settings?.visible === true) {
        topics.add(topic.name);
      }
    }
    return topics;
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (!topicIsConvertibleToSchema(topic, this.supportedImageSchemas)) {
        continue;
      }
      const imageTopic = topic.name;
      const config = (configTopics[imageTopic] ?? {}) as Partial<LayerSettingsImage>;

      // Build a list of all matching CameraInfo topics
      const cameraInfoOptions = Array.from(this.#cameraInfoTopics, (topicName) => ({
        label: topicName,
        value: topicName,
      }));
      cameraInfoOptions.sort();
      sortPrefixMatchesToFront(cameraInfoOptions, imageTopic, (option) => option.value);

      const fields: SettingsTreeFields = {
        cameraInfoTopic: {
          label: t("threeDee:cameraInfo"),
          input: "select",
          options: cameraInfoOptions,
          value: config.cameraInfoTopic,
        },
        distance: {
          label: t("threeDee:distance"),
          input: "number",
          placeholder: String(IMAGE_RENDERABLE_DEFAULT_SETTINGS.distance),
          step: 0.1,
          precision: PRECISION_DISTANCE,
          value: config.distance,
        },
        planarProjectionFactor: {
          label: t("threeDee:planarProjectionFactor"),
          input: "number",
          placeholder: String(IMAGE_RENDERABLE_DEFAULT_SETTINGS.planarProjectionFactor),
          min: 0,
          max: 1,
          step: 0.1,
          precision: 2,
          value: config.planarProjectionFactor,
        },
        color: { label: t("threeDee:color"), input: "rgba", value: config.color },
      };

      entries.push({
        path: ["topics", imageTopic],
        node: {
          icon: "ImageProjection",
          fields,
          visible: config.visible ?? IMAGE_RENDERABLE_DEFAULT_SETTINGS.visible,
          order: imageTopic.toLocaleLowerCase(),
          handler,
        },
      });
    }
    return entries;
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    const imageTopic = path[1]!;
    const prevSettings: Partial<LayerSettingsImage> | undefined =
      this.renderer.config.topics[imageTopic];
    const prevCameraInfoTopic = prevSettings?.cameraInfoTopic;

    this.saveSetting(path, action.payload.value);

    const settings: Partial<LayerSettingsImage> | undefined =
      this.renderer.config.topics[imageTopic];
    const cameraInfoTopic = settings?.cameraInfoTopic;

    // Add this camera_info_topic -> image_topic mapping
    if (cameraInfoTopic !== prevCameraInfoTopic && cameraInfoTopic != undefined) {
      this.#cameraInfoToImageTopics.set(cameraInfoTopic, imageTopic);
    }

    const renderable = this.renderables.get(imageTopic);
    if (!renderable) {
      return;
    }

    renderable.setSettings({ ...IMAGE_RENDERABLE_DEFAULT_SETTINGS, ...settings });

    // The camera info topic changed for our renderable
    // Remove the previous camera_info_topic -> image_topic mapping
    if (prevCameraInfoTopic != undefined) {
      this.#cameraInfoToImageTopics.delete(prevCameraInfoTopic, imageTopic);
    }

    // apply camera info to new renderable
    if (cameraInfoTopic == undefined) {
      return;
    }

    // Look up the camera info for our image topic
    const cameraInfo = this.#cameraInfoByTopic.get(cameraInfoTopic);
    if (!cameraInfo) {
      this.renderer.settings.errors.addToTopic(
        imageTopic,
        NO_CAMERA_INFO_ERR,
        `No CameraInfo received on ${cameraInfoTopic}`,
      );
      return;
    }
    this.#recomputeCameraModel(renderable, cameraInfo);
    renderable.update();
  };

  #cameraInfoShouldSubscribe = (cameraInfoTopic: string): boolean => {
    // Iterate over each topic config and check if it has a cameraInfoTopic setting that matches
    // the cameraInfoTopic we might want to turn on. If it does and the topic is visible, return
    // true so we know to subscribe.
    for (const topicConfig of Object.values(this.renderer.config.topics)) {
      const maybeImageConfig = topicConfig as Partial<LayerSettingsImage>;
      if (
        maybeImageConfig.cameraInfoTopic === cameraInfoTopic &&
        maybeImageConfig.visible === true
      ) {
        return true;
      }
    }

    return false;
  };

  #handleRosRawImage = (messageEvent: PartialMessageEvent<RosImage>): void => {
    void this.handleImage(messageEvent, normalizeRosImage(messageEvent.message));
  };

  #handleRosCompressedImage = (messageEvent: PartialMessageEvent<RosCompressedImage>): void => {
    void this.handleImage(messageEvent, normalizeRosCompressedImage(messageEvent.message));
  };

  #handleRawImage = (messageEvent: PartialMessageEvent<RawImage>): void => {
    void this.handleImage(messageEvent, normalizeRawImage(messageEvent.message));
  };

  #handleCompressedImage = (messageEvent: PartialMessageEvent<CompressedImage>): void => {
    void this.handleImage(messageEvent, normalizeCompressedImage(messageEvent.message));
  };

  #handleCompressedVideo = (messageEvent: PartialMessageEvent<CompressedVideo>): void => {
    const normalizedEvent = {
      ...messageEvent,
      message: normalizeCompressedVideo(messageEvent.message),
    } as MessageEvent<CompressedVideo>;
    this.#compressedVideoControllerForTopic(normalizedEvent.topic).processMessage(normalizedEvent, {
      resizeWidth: DEFAULT_BITMAP_WIDTH,
    });
  };

  protected handleImage = async (
    messageEvent: PartialMessageEvent<AnyImage>,
    image: AnyImage,
  ): Promise<ImageSetImageResult> => {
    const renderable = this.#prepareImageRenderable(messageEvent, image);
    return await renderable.setImage(image, DEFAULT_BITMAP_WIDTH);
  };

  #displayCompressedVideoFrames: CompressedVideoDisplayFrames = async (frames, _mode, options) => {
    const targetFrame = frames[frames.length - 1];
    if (targetFrame == undefined) {
      return { ok: false, reason: "failed" };
    }
    const renderable = this.#prepareImageRenderable(targetFrame, targetFrame.message, {
      deferImageState: true,
    });
    return await renderable.setCompressedVideoFrames(frames, {
      ...options,
      resizeWidth: options?.resizeWidth ?? DEFAULT_BITMAP_WIDTH,
    });
  };

  #filterCompressedVideoQueue = (
    queue: Parameters<typeof recordKeyframesAndFilterCompressedVideoQueue>[0],
  ): ReturnType<typeof recordKeyframesAndFilterCompressedVideoQueue> => {
    return recordKeyframesAndFilterCompressedVideoQueue(queue, (topic, receiveTime) => {
      this.#compressedVideoControllerForTopic(topic).recordKnownKeyframeReceiveTime(
        topic,
        receiveTime,
      );
    });
  };

  #compressedVideoControllerForTopic(topic: string): CompressedVideoController {
    let controller = this.#compressedVideoControllers.get(topic);
    if (controller == undefined) {
      controller = new CompressedVideoController({
        topic,
        renderer: this.renderer,
        displayFrames: this.#displayCompressedVideoFrames,
        resetDecoder: () => {
          this.renderables.get(topic)?.resetForSeek();
        },
        onSeekKeyframeSearchChange: this.#handleSeekKeyframeSearchChange,
      });
      this.#compressedVideoControllers.set(topic, controller);
    } else {
      controller.updateOptions({
        displayFrames: this.#displayCompressedVideoFrames,
        resetDecoder: () => {
          this.renderables.get(topic)?.resetForSeek();
        },
        onSeekKeyframeSearchChange: this.#handleSeekKeyframeSearchChange,
      });
    }
    return controller;
  }

  #handleSeekKeyframeSearchChange = ({ active }: SeekKeyframeSearchState): void => {
    this.hud.displayIfTrue(active, SEEK_KEYFRAME_SEARCH_HUD_ITEM);
  };

  #prepareImageRenderable(
    messageEvent: PartialMessageEvent<AnyImage>,
    image: AnyImage,
    options: { deferImageState?: boolean } = {},
  ): ImageRenderable {
    const imageTopic = messageEvent.topic;
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    const frameId = "header" in image ? image.header.frame_id : image.frame_id;

    const renderable = this.#getImageRenderable(
      imageTopic,
      receiveTime,
      options.deferImageState === true ? undefined : image,
      frameId,
    );

    if (options.deferImageState !== true) {
      renderable.userData.receiveTime = receiveTime;
    }
    // Auto-select settings.cameraInfoTopic if it's not already set
    const settings = renderable.userData.settings;
    if (settings.cameraInfoTopic == undefined) {
      const prefix = getTopicMatchPrefix(imageTopic);
      const newCameraInfoTopic =
        prefix != undefined
          ? filterMap(this.#cameraInfoTopics, (topic) =>
              topic.startsWith(prefix) ? topic : undefined,
            ).sort()[0]
          : undefined;
      settings.cameraInfoTopic = newCameraInfoTopic;
      renderable.setSettings(settings);

      // With no selected camera info topic, we show a topic error and bail
      // There's no way to render without camera info
      if (newCameraInfoTopic == undefined) {
        this.renderer.settings.errors.addToTopic(
          imageTopic,
          NO_CAMERA_INFO_ERR,
          "No CameraInfo topic found",
        );
        return renderable;
      }

      // We auto-selected a camera info topic for this image topic so we need to add the lookup.
      // Without this lookup, the handleCameraInfo won't know what image topics to update when
      // camera info messages arrive after image messages.

      // Update user settings with the newly selected CameraInfo topic
      this.renderer.updateConfig((draft) => {
        const updatedUserSettings = { ...settings };
        updatedUserSettings.cameraInfoTopic = newCameraInfoTopic;
        draft.topics[imageTopic] = updatedUserSettings;
      });
      this.updateSettingsTree();
    }

    assert(settings.cameraInfoTopic != undefined);
    this.#cameraInfoToImageTopics.set(settings.cameraInfoTopic, imageTopic);

    // Look up the camera info for our renderable
    const cameraInfo = this.#cameraInfoByTopic.get(settings.cameraInfoTopic);
    if (!cameraInfo) {
      this.renderer.settings.errors.addToTopic(
        imageTopic,
        NO_CAMERA_INFO_ERR,
        `No CameraInfo received on ${settings.cameraInfoTopic}`,
      );
    } else {
      this.#recomputeCameraModel(renderable, cameraInfo);
    }

    return renderable;
  }

  #handleCameraInfo = (
    messageEvent: PartialMessageEvent<CameraInfo> & PartialMessageEvent<CameraCalibration>,
  ): void => {
    // Store the last camera info on each topic, when processing an image message we'll look up
    // the camera info by the info topic configured for the image
    const cameraInfo = normalizeCameraInfo(messageEvent.message);
    this.#cameraInfoByTopic.set(messageEvent.topic, cameraInfo);

    // Look up any image topics assigned to our camera info topic and determine if we need to update
    // those renderables since we now have a camera info whereas we may not have previously
    const imageTopics = this.#cameraInfoToImageTopics.get(messageEvent.topic) ?? [];
    for (const imageTopic of imageTopics) {
      const renderable = this.renderables.get(imageTopic);
      if (!renderable) {
        continue;
      }

      // If there's no camera info topic assigned then we don't need to do update this renderable
      const settings = renderable.userData.settings;
      if (!settings.cameraInfoTopic || settings.cameraInfoTopic !== messageEvent.topic) {
        continue;
      }
      this.renderer.settings.errors.removeFromTopic(imageTopic, NO_CAMERA_INFO_ERR);

      this.#recomputeCameraModel(renderable, cameraInfo);
      renderable.update();
    }
  };

  /**
   * Recompute a new camera model if the newCameraInfo differs from the current renderable info. If
   * the info is unchanged then the existing camera model is returned.
   *
   * If a camera model could not be created this returns undefined.
   *
   * This function will set a topic error on the image topic if the camera model creation fails.
   */
  #recomputeCameraModel(renderable: ImageRenderable, newCameraInfo: CameraInfo) {
    // If the camera info has not changed, we don't need to make a new model and can return the existing one
    const dataEqual = cameraInfosEqual(renderable.userData.cameraInfo, newCameraInfo);
    if (dataEqual && renderable.userData.cameraModel != undefined) {
      return;
    }

    const imageTopic = renderable.userData.topic;

    try {
      renderable.setCameraModel(new PinholeCameraModel(newCameraInfo));
      renderable.userData.cameraInfo = newCameraInfo;
      this.renderer.settings.errors.removeFromTopic(imageTopic, CAMERA_MODEL);
    } catch (errUnk) {
      const err = errUnk as Error;
      this.renderer.settings.errors.addToTopic(imageTopic, CAMERA_MODEL, err.message);
    }
  }

  // Get or create an image renderable for the imageTopic
  #getImageRenderable(
    imageTopic: string,
    receiveTime: bigint,
    image: AnyImage | undefined,
    frameId: string,
  ): ImageRenderable {
    let renderable = this.renderables.get(imageTopic);
    if (renderable) {
      return renderable;
    }

    // Look up any existing settings for the image topic to save as user data with the renderable
    const userSettings: Partial<LayerSettingsImage> | undefined =
      this.renderer.config.topics[imageTopic];

    const messageTime = image
      ? toNanoSec("header" in image ? image.header.stamp : image.timestamp)
      : 0n;

    renderable = this.initRenderable(imageTopic, {
      receiveTime,
      messageTime: image ? toNanoSec("header" in image ? image.header.stamp : image.timestamp) : 0n,
      firstMessageTime: messageTime,
      frameId: this.renderer.normalizeFrameId(frameId),
      pose: makePose(),
      settingsPath: ["topics", imageTopic],
      topic: imageTopic,
      settings: { ...IMAGE_RENDERABLE_DEFAULT_SETTINGS, ...userSettings },
      cameraInfo: undefined,
      cameraModel: undefined,
      image,
      texture: undefined,
      material: undefined,
      geometry: undefined,
      mesh: undefined,
    });

    this.add(renderable);
    this.renderables.set(imageTopic, renderable);
    return renderable;
  }

  protected initRenderable(topicName: string, userData: ImageUserData): ImageRenderable {
    return new ImageRenderable(topicName, this.renderer, userData);
  }
}
