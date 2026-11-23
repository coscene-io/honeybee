/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";
import { createStore, type StoreApi } from "zustand";

import { CoreDataContext, type CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import { SEMANTIC_SEGMENTATION_FEATURE_FLAG } from "@foxglove/studio-base/semanticSegmentation/featureFlag";

import { ImagePanel } from "./index";

jest.mock("./ThreeDeeRender", () => ({ ThreeDeeRender: () => ReactNull }));
jest.mock("./SceneExtensionConfig", () => ({}));
jest.mock("@foxglove/studio-base/components/PanelExtensionAdapter/mountPanel", () => ({
  mountPanel: jest.fn(),
}));
const mockAdapterProps = jest.fn();

jest.mock("@foxglove/studio-base/components/Panel", () => ({
  __esModule: true,
  default: (component: unknown) => component,
}));
jest.mock("@foxglove/studio-base/components/PanelContext", () => ({
  usePanelContext: () => ({ id: "Image!1", enterFullscreen: jest.fn() }),
}));
jest.mock("@foxglove/studio-base/components/PanelExtensionAdapter", () => ({
  PanelExtensionAdapter: (props: Record<string, unknown>) => {
    mockAdapterProps(props);
    return <div data-testid="image-renderer" />;
  },
}));
jest.mock("@foxglove/studio-base/hooks/useTopicPublishFrequences", () => ({
  useTopicPublishFrequencies: () => ({}),
}));
jest.mock("@foxglove/studio-base/context/AppContext", () => ({
  INJECTED_FEATURE_KEYS: {},
  useAppContext: () => ({}),
}));
jest.mock("@foxglove/studio-base/components/ForwardAnalyticsContextProvider", () => ({
  useForwardAnalytics: () => ({}),
}));
jest.mock("@foxglove/studio-base/semanticSegmentation/components/SegmentationImageEntry", () => ({
  SegmentationImageEntry: () => <div data-testid="segmentation-entry" />,
}));
jest.mock("@foxglove/studio-base/semanticSegmentation/components/SegmentationWorkspace", () => ({
  SegmentationWorkspace: () => <div data-testid="segmentation-workspace" />,
}));
jest.mock(
  "@foxglove/studio-base/semanticSegmentation/components/SegmentationPropagateButton",
  () => ({ SegmentationPropagateButton: () => <div data-testid="segmentation-propagate" /> }),
);

const Image = ImagePanel as unknown as (props: {
  config: Record<string, unknown>;
  saveConfig: () => void;
}) => React.JSX.Element;

// The real rollout gate (no featureFlag mock): flag from cos-config, record from Core Data.
function renderOnCloudRecord(): void {
  const core = createStore(() => ({
    record: { loading: false, value: { name: "warehouses/w/projects/p/records/r" } },
  })) as unknown as StoreApi<CoreDataStore>;
  render(
    <CoreDataContext.Provider value={core}>
      <Image config={{ imageMode: { imageTopic: "/camera" } }} saveConfig={jest.fn()} />
    </CoreDataContext.Provider>,
  );
}

describe("Image panel on a cloud record, real rollout gate", () => {
  afterEach(() => {
    window.cosConfig = undefined;
  });

  it("stays the plain Image panel while the flag is off", () => {
    renderOnCloudRecord();
    expect(screen.getByTestId("image-renderer")).toBeTruthy();
    expect(screen.queryByTestId("segmentation-entry")).toBeNull();
    expect(screen.queryByTestId("segmentation-workspace")).toBeNull();
    const props = mockAdapterProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(props.additionalToolbarIcons).toBeUndefined();
  });

  it("mounts the editor once the flag is on", () => {
    window.cosConfig = {
      FEATURE_FLAG_GROWTHBOOK: { [SEMANTIC_SEGMENTATION_FEATURE_FLAG]: true },
    } as typeof window.cosConfig;
    renderOnCloudRecord();
    expect(screen.getByTestId("segmentation-entry")).toBeTruthy();
    expect(screen.getByTestId("segmentation-workspace")).toBeTruthy();
  });
});
