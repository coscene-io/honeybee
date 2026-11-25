// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render as renderUi, type RenderOptions } from "@testing-library/react";
import { Fragment, type ReactElement, type ReactNode } from "react";
import { createStore } from "zustand";

import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import { useDialogs } from "@foxglove/studio-base/context/DialogsContext";
import {
  WorkspaceContext,
  type WorkspaceContextStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import {
  WorkspaceSlotsProvider,
  createWorkspaceSlotsStore,
} from "@foxglove/studio-base/context/WorkspaceSlots";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import { makeWorkspaceContextInitialState } from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import {
  createSegmentationPanelBridge,
  type SegmentationImageMetadata,
  type SegmentationPanelBridge,
  type SegmentationRendererSources,
} from "../imageSource";
import { createSegmentationHost } from "../segmentationHost";
import { SegmentationHostContext, type SegmentationHost } from "../segmentationHostContext";

let registered = false;
let current: SegmentationHost | undefined;
let slots = createWorkspaceSlotsStore();
const createWorkspaceStore = () =>
  createStore<WorkspaceContextStore>(makeWorkspaceContextInitialState);
/** One workspace per test, so separately rendered trees see the same dialogs. */
let workspace = createWorkspaceStore();
let appConfiguration = makeMockAppConfiguration();

/**
 * Gives every test of the calling file a fresh host (created before it, disposed after it). Call
 * once at the top of a test file; `testHost()` and the `render` of this module then use it.
 */
export function installSegmentationTestHost(): void {
  if (registered) {
    return;
  }
  registered = true;
  beforeEach(() => {
    // The previous test's host is disposed here, not after it: the file's own afterEach hooks may
    // still read it.
    current?.dispose();
    current = createSegmentationHost();
    slots = createWorkspaceSlotsStore();
    workspace = createWorkspaceStore();
    appConfiguration = makeMockAppConfiguration();
  });
  afterAll(() => {
    current?.dispose();
    current = undefined;
  });
}

/** The host of the running test. Tests only. */
export function testHost(): SegmentationHost {
  if (!current) {
    throw new Error("Call installSegmentationTestHost() at the top of the test file");
  }
  return current;
}

/** The workspace slot store of the running test. Tests only. */
export function testSlots(): typeof slots {
  return slots;
}

/** Renders the open dialogs, as the app root does. */
function Dialogs(): React.JSX.Element {
  const dialogs = useDialogs((store) => store.dialogs);
  return (
    <>
      {[...dialogs].map(([key, dialog]) => (
        <Fragment key={key}>{dialog}</Fragment>
      ))}
    </>
  );
}

/** Provides the running test's host to what is rendered inside. */
export function TestHostProvider({ children }: { children?: ReactNode }): React.JSX.Element {
  return (
    <WorkspaceSlotsProvider store={slots}>
      <WorkspaceContext.Provider value={workspace}>
        <AppConfigurationContext.Provider value={appConfiguration}>
          <DialogsProvider>
            <SegmentationHostContext.Provider value={testHost()}>
              {children}
            </SegmentationHostContext.Provider>
            <Dialogs />
          </DialogsProvider>
        </AppConfigurationContext.Provider>
      </WorkspaceContext.Provider>
    </WorkspaceSlotsProvider>
  );
}

/** `render` with the running test's host in context. Tests only. */
export function render(
  ui: ReactElement,
  options: Omit<RenderOptions, "queries"> = {},
): ReturnType<typeof renderUi> {
  return renderUi(ui, { wrapper: TestHostProvider, ...options });
}

/** A panel bridge on the running test's host: tests publish the renderer's sources on it. */
export function createTestBridge(): SegmentationPanelBridge {
  const host = testHost();
  return createSegmentationPanelBridge({
    maskOverlay: host.maskOverlay,
    maskPlanes: host.maskPlanes,
  });
}

/** A displayed frame as tests describe it: the renderer would encode `imageUrl` on demand. */
export type TestImage = SegmentationImageMetadata & { imageUrl: string };

/** Renderer sources for a test bridge: only what the test supplies does anything. */
export function testSources({
  image,
  ...rest
}: Partial<Omit<SegmentationRendererSources, "image">> & {
  image: () => TestImage | undefined;
}): SegmentationRendererSources {
  return {
    image: () => {
      const shown = image();
      return shown && { ...shown, encodeImageUrl: () => shown.imageUrl };
    },
    imageMetadata: image,
    bounds: () => document.createElement("canvas").getBoundingClientRect(),
    cachedFrames: () => [],
    viewControls: {
      reset: () => {},
      zoom: () => {},
      panBy: () => {},
      wheel: () => {},
      mouseDown: () => {},
    },
    ...rest,
  };
}
