/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { BrowserSession, getBrowserSession } from "@foxglove/studio-base/util/browserSession";

import { useCloseLayoutDrawerOnSessionChange } from "./useCloseLayoutDrawerOnSessionChange";

jest.mock("@foxglove/studio-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: jest.fn(),
}));
jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  getBrowserSession: jest.fn(),
}));

function Boundary() {
  useCloseLayoutDrawerOnSessionChange();
  return <div>Workspace</div>;
}

function WorkspaceWithOpenDrawer() {
  const [open, setOpen] = useState(true);
  jest.mocked(useWorkspaceActions).mockReturnValue({
    layoutDrawer: {
      open: jest.fn(),
      close: () => {
        setOpen(false);
      },
    },
  } as unknown as ReturnType<typeof useWorkspaceActions>);
  return (
    <>
      <Boundary />
      {open && createPortal(<div role="dialog">Layouts</div>, document.body)}
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("coScene_org_jwt", "Bearer initial");
});

it.each(["changed", "recover", "logged-out"])("closes the portal layout drawer on %s", (status) => {
  const session = new BrowserSession();
  jest.mocked(getBrowserSession).mockReturnValue(session);
  render(<WorkspaceWithOpenDrawer />);
  expect(screen.getByRole("dialog")).not.toBeNull();
  act(() => {
    if (status === "recover") {
      session.rejectCredential("Bearer initial");
    } else {
      if (status === "logged-out") {
        localStorage.setItem(
          "coscene.auth.session-version.v1",
          JSON.stringify({
            version: "ab".repeat(16),
            reason: "logout",
            signOutPendingUntilMs: 0,
            isServerSignOutConfirmed: true,
          }) ?? "",
        );
        localStorage.removeItem("coScene_org_jwt");
      } else {
        localStorage.setItem("coScene_org_jwt", "Bearer replacement");
      }
      session.reconcile();
    }
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Workspace")).not.toBeNull();
});

it("keeps the drawer open for session-independent local playback", () => {
  const session = new BrowserSession();
  session.setLocalPlayback({ local: true });
  jest.mocked(getBrowserSession).mockReturnValue(session);
  render(<WorkspaceWithOpenDrawer />);
  act(() => {
    session.rejectCredential("Bearer initial");
  });
  expect(screen.getByRole("dialog")).not.toBeNull();
});

it("closes an open drawer when mounting with an already blocked session", () => {
  const session = new BrowserSession();
  session.rejectCredential("Bearer initial");
  jest.mocked(getBrowserSession).mockReturnValue(session);
  render(<WorkspaceWithOpenDrawer />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
