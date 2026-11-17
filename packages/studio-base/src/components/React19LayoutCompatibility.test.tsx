/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createDragDropManager } from "dnd-core";
import type { Backend, Identifier } from "dnd-core";
import { createRef, StrictMode } from "react";
import { Mosaic, MosaicWindow } from "react-mosaic-component";
import {
  Panel,
  Group,
  Separator,
  GroupImperativeHandle,
  PanelImperativeHandle,
} from "react-resizable-panels";

function createBackend() {
  const sources = new Map<HTMLElement, Identifier>();
  const targets = new Map<HTMLElement, Identifier>();
  const previews = new Map<HTMLElement, Identifier>();
  const connect = (nodes: Map<HTMLElement, Identifier>) => (id: Identifier, node: HTMLElement) => {
    nodes.set(node, id);
    return () => {
      nodes.delete(node);
    };
  };
  const backend: Backend = {
    setup: jest.fn(),
    teardown: jest.fn(),
    profile: () => ({}),
    connectDragSource: connect(sources),
    connectDragPreview: connect(previews),
    connectDropTarget: connect(targets),
  };
  return { backend, sources, targets, previews };
}

it("keeps Mosaic drag targets connected through StrictMode, moves, and layout changes", () => {
  const { backend, sources, targets, previews } = createBackend();
  const manager = createDragDropManager(() => backend);
  const onChange = jest.fn();
  const onDragEnd = jest.fn();
  const view = render(
    <StrictMode>
      <Mosaic<string>
        dragAndDropManager={manager}
        initialValue={{ direction: "row", first: "A", second: "B" }}
        onChange={onChange}
        renderTile={(id, path) => (
          <MosaicWindow<string> title={id} path={path} onDragEnd={onDragEnd}>
            <div data-testid={`panel-${id}`}>{id} content</div>
          </MosaicWindow>
        )}
      />
    </StrictMode>,
  );
  const dragRightOf = (source: string, destination: string) => {
    const sourceNode = view.getByTestId(`panel-${source}`).closest(".mosaic-window")!;
    const destinationNode = view.getByTestId(`panel-${destination}`).closest(".mosaic-window")!;
    const handle = sourceNode.querySelector<HTMLElement>(".mosaic-window-title")!;
    const target = destinationNode.querySelector<HTMLElement>(".drop-target.right")!;
    const sourceId = sources.get(handle);
    const targetId = targets.get(target);
    expect(sourceId).toBeDefined();
    expect(targetId).toBeDefined();
    act(() => {
      manager.getActions().beginDrag([sourceId!]);
      manager.getActions().hover([targetId!]);
      manager.getActions().drop();
      manager.getActions().endDrag();
    });
  };
  expect(sources.size).toBe(2);
  expect(previews.size).toBe(2);
  dragRightOf("A", "B");
  expect(onChange).toHaveBeenLastCalledWith({ direction: "row", first: "B", second: "A" });
  expect(onDragEnd).toHaveBeenLastCalledWith("drop");
  // The second drag needs the reconnected refs and current paths after the first layout update.
  dragRightOf("B", "A");
  expect(onChange).toHaveBeenLastCalledWith({ direction: "row", first: "A", second: "B" });
  expect(onDragEnd).toHaveBeenCalledTimes(2);
  fireEvent.click(view.getAllByTitle("Expand")[0]!);
  expect(onChange).toHaveBeenLastCalledWith({
    direction: "row",
    first: "A",
    second: "B",
    splitPercentage: 70,
  });
  expect(sources.size).toBe(2);
  view.unmount();
  expect(sources.size).toBe(0);
  expect(targets.size).toBe(0);
  expect(previews.size).toBe(0);
});

it("restores the resizable editor bottom bar after collapse without losing its contents", async () => {
  jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
  jest.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 1000, 1000));
  const group = createRef<GroupImperativeHandle>();
  const bottomBar = createRef<PanelImperativeHandle>();
  const onLayout = jest.fn();
  const view = render(
    <StrictMode>
      <Group orientation="vertical" groupRef={group} onLayoutChange={onLayout}>
        <Panel id="editor" defaultSize="70%">
          Editor
        </Panel>
        <Separator />
        <Panel
          id="bottom-bar"
          panelRef={bottomBar}
          collapsible
          collapsedSize={0}
          minSize="10%"
          defaultSize="30%"
        >
          <input aria-label="Saved log filter" defaultValue="initial" />
        </Panel>
      </Group>
    </StrictMode>,
  );
  const input = view.getByRole("textbox", { name: "Saved log filter" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "retained filter" } });
  await waitFor(() => {
    expect(group.current!.getLayout()).toEqual({ editor: 70, "bottom-bar": 30 });
  });
  act(() => {
    bottomBar.current!.collapse();
  });
  expect(bottomBar.current!.isCollapsed()).toBe(true);
  expect(group.current!.getLayout()).toEqual({ editor: 100, "bottom-bar": 0 });
  act(() => {
    bottomBar.current!.expand();
  });
  expect(group.current!.getLayout()).toEqual({ editor: 70, "bottom-bar": 30 });
  act(() => {
    bottomBar.current!.resize("45%");
  });
  act(() => {
    bottomBar.current!.collapse();
  });
  act(() => {
    bottomBar.current!.expand();
  });
  expect(group.current!.getLayout()).toEqual({ editor: 55, "bottom-bar": 45 });
  expect(input.value).toBe("retained filter");
  expect(input.isConnected).toBe(true);
  expect(bottomBar.current!.getSize().asPercentage).toBe(45);
  expect(onLayout).toHaveBeenCalledWith({ editor: 100, "bottom-bar": 0 });
  expect(onLayout).toHaveBeenLastCalledWith({ editor: 55, "bottom-bar": 45 });
  view.unmount();
  expect(bottomBar.current).toBeNull();
  expect(group.current).toBeNull();
});
