// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render as renderUi, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import {
  KeyboardShortcutsDialogProvider,
  createKeyboardShortcutsDialogStore,
} from "@foxglove/studio-base/components/PlaybackControls/keyboardShortcutsDialogStore";
import {
  WorkspaceSlotsProvider,
  createWorkspaceSlotsStore,
} from "@foxglove/studio-base/context/WorkspaceSlots";

import { createSegmentationPanelBridge, type SegmentationPanelBridge } from "../imageSource";
import { createSegmentationHost } from "../segmentationHost";
import { SegmentationHostContext, type SegmentationHost } from "../segmentationHostContext";

let registered = false;
let current: SegmentationHost | undefined;
let slots = createWorkspaceSlotsStore();
let shortcuts = createKeyboardShortcutsDialogStore();

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
    shortcuts = createKeyboardShortcutsDialogStore();
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

/** The shortcuts dialog store of the running test (set `{ open: true }` to open it). Tests only. */
export function testShortcutsDialog(): typeof shortcuts {
  return shortcuts;
}

/** Provides the running test's host to what is rendered inside. */
export function TestHostProvider({ children }: { children?: ReactNode }): React.JSX.Element {
  return (
    <WorkspaceSlotsProvider store={slots}>
      <KeyboardShortcutsDialogProvider store={shortcuts}>
        <SegmentationHostContext.Provider value={testHost()}>
          {children}
        </SegmentationHostContext.Provider>
      </KeyboardShortcutsDialogProvider>
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
