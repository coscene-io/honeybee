// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  StrictMode,
  Suspense,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { DeepPartial } from "ts-essentials";

import { useCrash } from "@foxglove/hooks";
import { CaptureErrorBoundary } from "@foxglove/studio-base/components/CaptureErrorBoundary";
import {
  ForwardAnalyticsContextProvider,
  ForwardedAnalytics,
  useForwardAnalytics,
} from "@foxglove/studio-base/components/ForwardAnalyticsContextProvider";
import Panel from "@foxglove/studio-base/components/Panel";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import {
  BuiltinPanelExtensionContext,
  PanelExtensionAdapter,
} from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { mountPanel } from "@foxglove/studio-base/components/PanelExtensionAdapter/mountPanel";
import { INJECTED_FEATURE_KEYS, useAppContext } from "@foxglove/studio-base/context/AppContext";
import { useTopicPublishFrequencies } from "@foxglove/studio-base/hooks/useTopicPublishFrequences";
import { TestOptions } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
import { useSegmentationEnabled } from "@foxglove/studio-base/segmentation/featureFlag";
import type { SegmentationPanelBridge } from "@foxglove/studio-base/segmentation/imageSource";
import { SegmentationHostContext } from "@foxglove/studio-base/segmentation/segmentationHostContext";
import {
  PlaybackDiagnosticsContext,
  type PanelDiagnostics,
} from "@foxglove/studio-base/services/playbackDiagnostics";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { SceneExtensionConfig } from "./SceneExtensionConfig";
import { ThreeDeeRender } from "./ThreeDeeRender";
import { TOPIC_MESSAGE_FREQUENCIES_EXTENSION_DATA_KEY } from "./topicMessageFrequencies";
import { InterfaceMode } from "./types";

type InitPanelArgs = {
  diagnostics?: PanelDiagnostics;
  crash: ReturnType<typeof useCrash>;
  forwardedAnalytics: ForwardedAnalytics;
  interfaceMode: InterfaceMode;
  testOptions: TestOptions;
  customSceneExtensions?: DeepPartial<SceneExtensionConfig>;
  /** Connects the image to the segmentation editor (feature flag on and a cloud record open). */
  segmentation?: SegmentationPanelBridge;
};

function initPanel(args: InitPanelArgs, context: BuiltinPanelExtensionContext) {
  const { crash, forwardedAnalytics, interfaceMode, testOptions, customSceneExtensions } = args;
  return mountPanel(
    context.panelElement,
    <StrictMode>
      <CaptureErrorBoundary onError={crash}>
        <ForwardAnalyticsContextProvider forwardedAnalytics={forwardedAnalytics}>
          <ThreeDeeRender
            diagnostics={args.diagnostics}
            context={context}
            interfaceMode={interfaceMode}
            testOptions={testOptions}
            customSceneExtensions={customSceneExtensions}
            segmentation={args.segmentation}
          />
        </ForwardAnalyticsContextProvider>
      </CaptureErrorBoundary>
    </StrictMode>,
  );
}

type Props = {
  config: Record<string, unknown>;
  saveConfig: SaveConfig<Record<string, unknown>>;
  onDownloadImage?: (blob: Blob, fileName: string) => void;
  debugPicking?: boolean;
};

type AdapterContentProps = Props & {
  extensionData?: Record<string, unknown>;
  interfaceMode: InterfaceMode;
  additionalToolbarIcons?: ReactNode;
  segmentation?: SegmentationPanelBridge;
};

function ThreeDeeRenderAdapterContent(props: AdapterContentProps) {
  const { interfaceMode, additionalToolbarIcons, segmentation } = props;
  const crash = useCrash();
  const session = useContext(PlaybackDiagnosticsContext);
  const { id: panelId } = usePanelContext();
  const diagnostics = useMemo(
    () => (session ? { session, panelId } : undefined),
    [session, panelId],
  );
  const imageTopic = (props.config.imageMode as { imageTopic?: string } | undefined)?.imageTopic;
  useEffect(() => {
    if (interfaceMode === "image" && imageTopic) {
      return session?.bind(panelId, imageTopic);
    }
    return undefined;
  }, [session, panelId, interfaceMode, imageTopic]);

  const forwardedAnalytics = useForwardAnalytics();
  const { injectedFeatures } = useAppContext();
  const customSceneExtensions = useMemo(() => {
    if (injectedFeatures == undefined) {
      return undefined;
    }
    const injectedSceneExtensions =
      injectedFeatures.availableFeatures[INJECTED_FEATURE_KEYS.customSceneExtensions]
        ?.customSceneExtensions;
    return injectedSceneExtensions;
  }, [injectedFeatures]);

  const boundInitPanel = useMemo(
    () =>
      initPanel.bind(undefined, {
        diagnostics,
        crash,
        forwardedAnalytics,
        interfaceMode,
        testOptions: { onDownloadImage: props.onDownloadImage, debugPicking: props.debugPicking },
        customSceneExtensions,
        segmentation,
      }),
    [
      diagnostics,
      crash,
      forwardedAnalytics,
      interfaceMode,
      props.onDownloadImage,
      props.debugPicking,
      customSceneExtensions,
      segmentation,
    ],
  );

  return (
    <PanelExtensionAdapter
      config={props.config}
      extensionData={props.extensionData}
      highestSupportedConfigVersion={1}
      saveConfig={props.saveConfig}
      initPanel={boundInitPanel}
      additionalToolbarIcons={additionalToolbarIcons}
    />
  );
}

function ImagePanelAdapter(props: Props) {
  const topicMessageFrequencies = useTopicPublishFrequencies();
  const extensionData = useMemo(
    () => ({ [TOPIC_MESSAGE_FREQUENCIES_EXTENSION_DATA_KEY]: topicMessageFrequencies }),
    [topicMessageFrequencies],
  );
  // Segmentation is behind a rollout flag and needs a cloud record. Otherwise the Image
  // panel is exactly the plain one: no editor, no per-frame events, no AnnotationService calls.
  const segmentation = useSegmentationEnabled();

  if (!segmentation) {
    return (
      <ThreeDeeRenderAdapterContent
        {...props}
        interfaceMode="image"
        extensionData={extensionData}
      />
    );
  }
  return <SegmentationImagePanel {...props} extensionData={extensionData} />;
}

// The editor is loaded only when it is used (flag on and a cloud record open), so other Image
// panels and the 3D panel never download it.
const SegmentationImagePanelAdapter = lazy(async () => ({
  default: (
    await import("@foxglove/studio-base/segmentation/components/SegmentationImagePanelAdapter")
  ).SegmentationImagePanelAdapter,
}));

function SegmentationImagePanel(props: Props & { extensionData: Record<string, unknown> }) {
  // The workspace's extension provides the host once the editor's core has loaded.
  const host = useContext(SegmentationHostContext);
  const imageTopic = (props.config.imageMode as { imageTopic?: string } | undefined)?.imageTopic;
  const renderPanel = useCallback(
    ({
      additionalToolbarIcons,
      segmentation,
    }: {
      additionalToolbarIcons: ReactNode;
      segmentation: SegmentationPanelBridge;
    }) => (
      <ThreeDeeRenderAdapterContent
        {...props}
        interfaceMode="image"
        additionalToolbarIcons={additionalToolbarIcons}
        segmentation={segmentation}
      />
    ),
    [props],
  );
  if (host == undefined) {
    return ReactNull;
  }
  return (
    <Suspense fallback={ReactNull}>
      <SegmentationImagePanelAdapter imageTopic={imageTopic} renderPanel={renderPanel} />
    </Suspense>
  );
}

function ThreeDeeRenderAdapter(interfaceMode: InterfaceMode, props: Props) {
  if (interfaceMode === "image") {
    return <ImagePanelAdapter {...props} />;
  }

  return <ThreeDeeRenderAdapterContent {...props} interfaceMode={interfaceMode} />;
}

/**
 * The Image panel is a special case of the 3D panel with `interfaceMode` set to `"image"`.
 */
export const ImagePanel = Panel<Record<string, unknown>, Props>(
  Object.assign(ThreeDeeRenderAdapter.bind(undefined, "image"), {
    panelType: "Image",
    defaultConfig: {},
  }),
);

export default Panel(
  Object.assign(ThreeDeeRenderAdapter.bind(undefined, "3d"), {
    panelType: "3D",
    defaultConfig: {},
  }),
);
