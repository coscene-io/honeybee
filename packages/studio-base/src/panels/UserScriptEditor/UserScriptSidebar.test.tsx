/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, within, waitFor, render, screen } from "@testing-library/react";
import { ComponentProps, Fragment } from "react";

import {
  LayoutID,
  useCurrentLayoutActions,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useDialogs } from "@foxglove/studio-base/context/DialogsContext";
import {
  useUserScriptState,
  UserScriptStateProvider,
  type UserScriptStore,
} from "@foxglove/studio-base/context/UserScriptStateContext";
import { useWorkspaceStore } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import ExtensionCatalogProvider from "@foxglove/studio-base/providers/ExtensionCatalogProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import PanelSetup from "@foxglove/studio-base/test/PanelSetup";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import type Editor from "./Editor";
import UserScriptSidebar from "./UserScriptSidebar";
import LegacyUserScriptPanel from "./index";

const mockCopy = jest.fn();
jest.mock("react-use", () => ({
  ...jest.requireActual("react-use"),
  useCopyToClipboard: () => [{}, mockCopy],
}));

jest.mock("./Editor", () => ({
  __esModule: true,
  default: ({ script, setScriptCode }: ComponentProps<typeof Editor>) => (
    <textarea
      aria-label="Editor"
      value={script?.code ?? ""}
      readOnly={script?.readOnly}
      onChange={(event) => {
        setScriptCode(event.target.value);
      }}
    />
  ),
}));

const layoutA = {
  id: "a" as LayoutID,
  data: {
    configById: {},
    globalVariables: {},
    userNodes: { shared: { name: "first", sourceCode: "initial" } },
  },
};
const layoutB = { ...layoutA, id: "b" as LayoutID };

function OpenDialogs() {
  const dialogs = useDialogs((state) => state.dialogs);
  return (
    <>
      {Array.from(dialogs, ([id, dialog]) => (
        <Fragment key={id}>{dialog}</Fragment>
      ))}
    </>
  );
}

function setup() {
  let actions: ReturnType<typeof useCurrentLayoutActions>;
  let scriptActions: UserScriptStore["actions"];
  function Content({ open }: { open: boolean }) {
    actions = useCurrentLayoutActions();
    scriptActions = useUserScriptState((store) => store.actions);
    return open ? <UserScriptSidebar /> : ReactNull;
  }
  const ui = (visibility: "open" | "closed") => (
    <ThemeProvider isDark>
      <MockCurrentLayoutProvider>
        <WorkspaceContextProvider disablePersistence>
          <UserScriptStateProvider>
            <ExtensionCatalogProvider loaders={[]}>
              <DialogsProvider>
                <Content open={visibility === "open"} />
                <OpenDialogs />
              </DialogsProvider>
            </ExtensionCatalogProvider>
          </UserScriptStateProvider>
        </WorkspaceContextProvider>
      </MockCurrentLayoutProvider>
    </ThemeProvider>
  );
  const view = render(ui("open"));
  return {
    select: (layout: typeof layoutA) => {
      act(() => {
        actions.setCurrentLayout(layout);
      });
    },
    scriptActions: () => scriptActions,
    scripts: () => actions.getCurrentLayoutState().selectedLayout?.data?.userNodes,
    close: () => {
      view.rerender(ui("closed"));
    },
  };
}

it("keeps drafts in their owning layout when two layouts share a script ID, and saves on sidebar close", async () => {
  const view = setup();
  view.select(layoutA);
  fireEvent.change(await screen.findByRole("textbox", { name: "Editor" }), {
    target: { value: "draft for layout A" },
  });
  view.select(layoutB);
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Editor" })).value).toBe(
    "initial",
  );
  expect(view.scripts()).toEqual(layoutB.data.userNodes);
  view.select(layoutA);
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Editor" })).value).toBe(
    "draft for layout A",
  );
  view.close();
  expect(view.scripts()?.shared?.sourceCode).toBe("draft for layout A");
});

it("opens a utility without a user script and creates a script from a template in the same sidebar", async () => {
  const view = setup();
  const picker = screen.getByRole("combobox");
  fireEvent.mouseDown(picker);
  fireEvent.click(await screen.findByRole("option", { name: "time.ts" }));
  expect(
    (await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Editor" })).readOnly,
  ).toBe(true);
  expect(view.scripts()).toEqual({});
  fireEvent.mouseDown(picker);
  fireEvent.click(await screen.findByRole("option", { name: "GPS Location" }));
  const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Editor" });
  expect(editor.readOnly).toBe(false);
  expect(Object.values(view.scripts() ?? {})).toEqual([
    expect.objectContaining({
      name: "GPS Location",
      sourceCode: expect.stringContaining("LocationFix"),
    }),
  ]);
});

it("opens the script referenced by a legacy tile without editing its saved layout", async () => {
  const panelId = "NodePlayground!legacy";
  const onLayoutAction = jest.fn();
  function Sidebar() {
    const right = useWorkspaceStore((store) => store.sidebars.right);
    return right.open && right.item === "user-scripts" ? <UserScriptSidebar /> : ReactNull;
  }
  render(
    <PanelSetup
      fixture={{
        layout: panelId,
        savedProps: { [panelId]: { selectedNodeId: "second", autoFormatOnSave: false } },
        userScripts: {
          ...layoutA.data.userNodes,
          second: { name: "legacy selection", sourceCode: "second script" },
        },
      }}
      onLayoutAction={onLayoutAction}
    >
      <LegacyUserScriptPanel childId={panelId} />
      <DialogsProvider>
        <Sidebar />
      </DialogsProvider>
    </PanelSetup>,
  );
  onLayoutAction.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Open User Scripts in the right sidebar" }));
  const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Editor" });
  expect(editor.value).toBe("second script");
  expect(
    screen.getByRole("button", { name: "Auto-format on save" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(onLayoutAction).not.toHaveBeenCalled();
});

it("names the script before deletion and keeps the draft on cancel", async () => {
  const view = setup();
  view.select(layoutA);
  const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Editor" });
  fireEvent.change(editor, { target: { value: "unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("Delete “first”?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(editor.value).toBe("unsaved");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => {
    expect(view.scripts()).toEqual({});
  });
});

it("opts legacy scripts into standard rotation without losing pending edits", async () => {
  const view = setup();
  view.select(layoutA);
  const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Editor" });
  fireEvent.change(editor, { target: { value: "draft" } });
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(
    await screen.findByRole("option", { name: "Switch rotate() to right-hand rotation" }),
  );
  expect(view.scripts()?.shared?.rotationConvention).toBe("standard");
  expect(editor.value).toBe("draft");
  view.close();
  expect(view.scripts()?.shared?.sourceCode).toBe("draft");
});

it("copies structured logs in order and displays per-script measurements", async () => {
  const view = setup();
  view.select(layoutA);
  act(() => {
    view.scriptActions().addUserScriptLogs("shared", [
      { source: "processMessage", value: "reading" },
      { source: "processMessage", value: { clocks: [123n], values: new Uint8Array([4, 5]) } },
    ]);
    view
      .scriptActions()
      .setTimings(
        new Map([["shared", { name: "first", calls: 2, totalMs: 6, maxMs: 4, compileMs: 10 }]]),
      );
  });
  fireEvent.click(screen.getByTestId("np-logs"));
  fireEvent.click(screen.getByRole("button", { name: "Copy all logs" }));
  expect(mockCopy).toHaveBeenCalledWith('reading\n{"clocks":["123"],"values":[4,5]}');
  fireEvent.click(screen.getByRole("tab", { name: "Timing" }));
  expect(
    await screen.findByText("2 calls · mean 3.00 ms · max 4.00 ms · compile 10.0 ms"),
  ).toBeTruthy();
});
