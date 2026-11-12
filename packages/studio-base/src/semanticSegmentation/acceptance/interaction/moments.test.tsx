/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { fixture } from "./fixtures";
import {
  ActiveMomentReference,
  SpatialReferenceValue,
} from "../../components/ActiveMomentReference";
import { parseSpatialReference } from "../../components/MomentReferencePicker";
import { createSegmentationRuntime, segmentationSession } from "../../runtime";

afterEach(() => {
  cleanup();
  segmentationSession.setState({ runtime: undefined, open: false, sourceReady: true });
});

function ReferenceField({ recordId }: { recordId: string }): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <label>
      Attribute Value
      <input aria-label="stored attribute" value={value} readOnly />
      <ActiveMomentReference recordId={recordId} value={value} onChange={setValue} />
    </label>
  );
}

it.each(["class", "instance"] as const)(
  "a moment attribute stores a spatial %s id and list/details follow rename and retirement",
  async (type) => {
    const document = fixture();
    const targetId =
      type === "class"
        ? "7c8c9505-9fa0-4c63-8fe2-957d107ddc7b"
        : "83e2ee9e-6048-41cc-86f0-06d8f0ca54fa";
    if (type === "class") {
      document.classes[0]!.id = targetId;
      for (const instance of document.instances.filter((item) => item.classId === "class-1")) {
        instance.classId = targetId;
      }
    } else {
      document.instances.find((item) => item.id === "instance-empty")!.id = targetId;
    }
    const runtime = createSegmentationRuntime(document);
    runtime.service.setControls({ delayMs: 0 });
    await runtime.initialize();
    segmentationSession.setState({ runtime, sourceReady: true });
    render(
      <>
        <ReferenceField recordId="record-1" />
        <SpatialReferenceValue value="" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择类别或实例" }), {
      target: { value: `${type}/${targetId}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "插入引用" }));
    const input = screen.getByLabelText("stored attribute");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("attribute field is not an input");
    }
    const value = input.value;
    expect(parseSpatialReference(value)).toEqual({
      recordId: "record-1",
      videoId: "video-1",
      targetType: type,
      targetId,
    });
    const serialized = JSON.stringify({ target: value });
    if (serialized == undefined) {
      throw new Error("Saved attribute did not serialize");
    }
    const saved = JSON.parse(serialized) as { target: string };
    cleanup();
    render(
      <>
        <SpatialReferenceValue value={saved.target} />
        <SpatialReferenceValue value={saved.target} />
      </>,
    );
    act(() => {
      if (type === "class") {
        runtime.store.getState().renameClass(targetId, "Latest class");
      } else {
        runtime.store.getState().renameInstance(targetId, "Latest instance");
        runtime.store.getState().moveInstance(targetId, "class-2");
      }
      runtime.store.getState().setCurrentFrame("frame-1");
    });
    expect(screen.getAllByText(new RegExp(`Latest ${type}`))).toHaveLength(2);
    act(() => {
      runtime.store.getState().setCurrentFrame("frame-2");
    });
    expect(screen.getAllByText(new RegExp(`Latest ${type}`))).toHaveLength(2);
    act(() => {
      if (type === "class") {
        runtime.store.getState().deleteClass(targetId);
      } else {
        runtime.store.getState().mergeInstances([targetId], "instance-2");
      }
    });
    expect(screen.getAllByText(new RegExp(`${targetId}.*已删除`))).toHaveLength(2);
    expect(saved.target).toBe(value);
    runtime.dispose();
  },
);

it("cancelling the reference picker leaves a scalar attribute value editable", async () => {
  const runtime = createSegmentationRuntime(fixture());
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  segmentationSession.setState({ runtime, sourceReady: true });
  const onChange = jest.fn();
  render(<ActiveMomentReference recordId="record-1" value="12.5" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
  fireEvent.change(screen.getByRole("combobox", { name: "选择类别或实例" }), {
    target: { value: "instance/instance-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onChange).not.toHaveBeenCalled();
  runtime.dispose();
});

it("does not replace record A's reference with a target from record B", async () => {
  const a = createSegmentationRuntime(fixture());
  const documentB = fixture();
  documentB.record.id = "record-B";
  documentB.videos = documentB.videos.map((video) => ({ ...video, recordId: "record-B" }));
  documentB.instances.find((item) => item.id === "instance-empty")!.id = "foreign-I";
  const b = createSegmentationRuntime(documentB);
  for (const runtime of [a, b]) {
    runtime.service.setControls({ delayMs: 0 });
    await runtime.initialize();
  }
  segmentationSession.setState({ runtime: a, sourceReady: true });
  const onChange = jest.fn();
  const scopedA = "spatial://record-1/video-1/instance/instance-1";
  const view = render(
    <ActiveMomentReference recordId="record-1" value={scopedA} onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
  fireEvent.change(screen.getByRole("combobox", { name: "选择类别或实例" }), {
    target: { value: "instance/instance-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "插入引用" }));
  expect(onChange).toHaveBeenCalledWith(scopedA);
  onChange.mockClear();
  act(() => {
    segmentationSession.setState({ runtime: b });
  });
  view.rerender(<ActiveMomentReference recordId="record-1" value={scopedA} onChange={onChange} />);
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "引用空间类别或实例" });
  expect(button.disabled).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  a.dispose();
  b.dispose();
});
