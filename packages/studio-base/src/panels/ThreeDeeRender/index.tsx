// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StrictMode, useMemo } from "react";
import ReactDOM from "react-dom";
import { DeepPartial } from "ts-essentials";

import { useCrash } from "@foxglove/hooks";
import { CaptureErrorBoundary } from "@foxglove/studio-base/components/CaptureErrorBoundary";
import {
  ForwardAnalyticsContextProvider,
  ForwardedAnalytics,
  useForwardAnalytics,
} from "@foxglove/studio-base/components/ForwardAnalyticsContextProvider";
import Panel from "@foxglove/studio-base/components/Panel";
import {
  BuiltinPanelExtensionContext,
  PanelExtensionAdapter,
} from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { INJECTED_FEATURE_KEYS, useAppContext } from "@foxglove/studio-base/context/AppContext";
import { useTopicPublishFrequencies } from "@foxglove/studio-base/hooks/useTopicPublishFrequences";
import { TestOptions } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { SceneExtensionConfig } from "./SceneExtensionConfig";
import { ThreeDeeRender } from "./ThreeDeeRender";
import { TOPIC_MESSAGE_FREQUENCIES_EXTENSION_DATA_KEY } from "./topicMessageFrequencies";
import { InterfaceMode } from "./types";

type InitPanelArgs = {
  crash: ReturnType<typeof useCrash>;
  forwardedAnalytics: ForwardedAnalytics;
  interfaceMode: InterfaceMode;
  testOptions: TestOptions;
  customSceneExtensions?: DeepPartial<SceneExtensionConfig>;
};

function initPanel(args: InitPanelArgs, context: BuiltinPanelExtensionContext) {
  const { crash, forwardedAnalytics, interfaceMode, testOptions, customSceneExtensions } = args;
  // eslint-disable-next-line react/no-deprecated, @typescript-eslint/no-deprecated
  ReactDOM.render(
    <StrictMode>
      <CaptureErrorBoundary onError={crash}>
        <ForwardAnalyticsContextProvider forwardedAnalytics={forwardedAnalytics}>
          <ThreeDeeRender
            context={context}
            interfaceMode={interfaceMode}
            testOptions={testOptions}
            customSceneExtensions={customSceneExtensions}
          />
        </ForwardAnalyticsContextProvider>
      </CaptureErrorBoundary>
    </StrictMode>,
    context.panelElement,
  );
  return () => {
    // eslint-disable-next-line react/no-deprecated, @typescript-eslint/no-deprecated
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
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
};

function ThreeDeeRenderAdapterContent(props: AdapterContentProps) {
  const { interfaceMode } = props;
  const crash = useCrash();

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
        crash,
        forwardedAnalytics,
        interfaceMode,
        testOptions: { onDownloadImage: props.onDownloadImage, debugPicking: props.debugPicking },
        customSceneExtensions,
      }),
    [
      crash,
      forwardedAnalytics,
      interfaceMode,
      props.onDownloadImage,
      props.debugPicking,
      customSceneExtensions,
    ],
  );

  return (
    <PanelExtensionAdapter
      config={props.config}
      extensionData={props.extensionData}
      highestSupportedConfigVersion={1}
      saveConfig={props.saveConfig}
      initPanel={boundInitPanel}
    />
  );
}

function ImagePanelAdapter(props: Props) {
  const topicMessageFrequencies = useTopicPublishFrequencies();
  const extensionData = useMemo(
    () => ({ [TOPIC_MESSAGE_FREQUENCIES_EXTENSION_DATA_KEY]: topicMessageFrequencies }),
    [topicMessageFrequencies],
  );

  return (
    <ThreeDeeRenderAdapterContent {...props} interfaceMode="image" extensionData={extensionData} />
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
