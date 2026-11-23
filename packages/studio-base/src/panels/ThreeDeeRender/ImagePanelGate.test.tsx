/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import { ImagePanel } from "./index";

let mockEnabled = false;
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
jest.mock("@foxglove/studio-base/semanticSegmentation/featureFlag", () => ({
  useSemanticSegmentationEnabled: () => mockEnabled,
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

describe("Image panel spatial annotation gate", () => {
  beforeEach(() => {
    mockAdapterProps.mockClear();
  });

  it("is the plain Image panel when annotation is off", () => {
    mockEnabled = false;
    render(<Image config={{}} saveConfig={jest.fn()} />);
    expect(screen.getByTestId("image-renderer")).toBeTruthy();
    expect(screen.queryByTestId("segmentation-entry")).toBeNull();
    expect(screen.queryByTestId("segmentation-workspace")).toBeNull();
    const props = mockAdapterProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(props.additionalToolbarIcons).toBeUndefined();
  });

  it("mounts the editor entry, workspace and propagate button when annotation is on", () => {
    mockEnabled = true;
    render(<Image config={{ imageMode: { imageTopic: "/camera" } }} saveConfig={jest.fn()} />);
    expect(screen.getByTestId("segmentation-entry")).toBeTruthy();
    expect(screen.getByTestId("segmentation-workspace")).toBeTruthy();
    const props = mockAdapterProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(props.additionalToolbarIcons).toBeDefined();
  });
});
