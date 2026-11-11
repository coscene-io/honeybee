/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";
import type { Backend } from "dnd-core";
import { ReactElement, Ref, RefCallback, StrictMode, createRef } from "react";
import { SourceConnector } from "react-dnd/dist/internals/SourceConnector";
// Exercise the connector implementation used by Mosaic, including our retained reconnect patch.
import { wrapConnectorHooks } from "react-dnd/dist/internals/wrapConnectorHooks";

type Connect = (element: ReactElement<{ ref: Ref<HTMLDivElement> }>) => ReactElement;

it("composes React 19 ref cleanups without reading element.ref", () => {
  const cleanup = jest.fn();
  const previousRef = jest.fn(() => cleanup);
  const connectNode = jest.fn();
  const hooks = wrapConnectorHooks({ dragSource: connectNode }) as { dragSource: () => Connect };
  const connect = hooks.dragSource();
  const { unmount } = render(<StrictMode>{connect(<div ref={previousRef} />)}</StrictMode>);
  const attachmentCount = previousRef.mock.calls.length;
  unmount();
  expect(cleanup).toHaveBeenCalledTimes(attachmentCount);
  expect(connectNode).toHaveBeenLastCalledWith(ReactNull);
});

it("clears object refs and disconnects the connector on unmount", () => {
  const previousRef = createRef<HTMLDivElement>();
  const connectNode = jest.fn();
  const hooks = wrapConnectorHooks({ dragSource: connectNode }) as { dragSource: () => Connect };
  const { unmount } = render(hooks.dragSource()(<div ref={previousRef} />));
  expect(previousRef.current).toBeInstanceOf(HTMLDivElement);
  unmount();
  expect(previousRef.current).toBeNull();
  expect(connectNode).toHaveBeenLastCalledWith(ReactNull);
});

it("disconnects DnD even when the element owner's ref cleanup throws", () => {
  const error = new Error("ref cleanup failed");
  const previousRef = () => () => {
    throw error;
  };
  const connectNode = jest.fn();
  const hooks = wrapConnectorHooks({ dragSource: connectNode }) as { dragSource: () => Connect };
  const element = hooks.dragSource()(<div ref={previousRef} />) as ReactElement<{
    ref: RefCallback<HTMLDivElement>;
  }>;
  const cleanup = element.props.ref(document.createElement("div"));
  expect(cleanup).toThrow(error);
  expect(connectNode).toHaveBeenLastCalledWith(ReactNull);
});

it("reconnects an unchanged drag source and preview after effect cleanup", () => {
  const disconnectSource = jest.fn();
  const disconnectPreview = jest.fn();
  const connectDragSource = jest.fn(() => disconnectSource);
  const connectDragPreview = jest.fn(() => disconnectPreview);
  const backend: Backend = {
    setup: jest.fn(),
    teardown: jest.fn(),
    profile: () => ({}),
    connectDragSource,
    connectDragPreview,
    connectDropTarget: jest.fn(() => () => {}),
  };
  const connector = new SourceConnector(backend);
  const hooks = connector.hooks as {
    dragSource: () => (node: HTMLElement | typeof ReactNull) => void;
    dragPreview: () => (node: HTMLElement | typeof ReactNull) => void;
  };
  const source = document.createElement("div");
  const preview = document.createElement("div");
  connector.receiveHandlerId("source");
  hooks.dragSource()(source);
  hooks.dragPreview()(preview);
  expect(connectDragSource).toHaveBeenCalledTimes(1);
  expect(connectDragPreview).toHaveBeenCalledTimes(1);
  connector.disconnectDragSource();
  connector.disconnectDragPreview();
  connector.reconnect();
  expect(connectDragSource).toHaveBeenCalledTimes(2);
  expect(connectDragPreview).toHaveBeenCalledTimes(2);
  expect(connectDragSource).toHaveBeenLastCalledWith("source", source, ReactNull);
  expect(connectDragPreview).toHaveBeenLastCalledWith("source", preview, ReactNull);
  // Repeated reconciliation must not create duplicate backend registrations.
  connector.reconnect();
  expect(connectDragSource).toHaveBeenCalledTimes(2);
  expect(connectDragPreview).toHaveBeenCalledTimes(2);
  hooks.dragSource()(ReactNull);
  hooks.dragPreview()(ReactNull);
  expect(disconnectSource).toHaveBeenCalledTimes(2);
  expect(disconnectPreview).toHaveBeenCalledTimes(2);
});
