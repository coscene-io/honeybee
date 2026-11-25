// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import i18n from "i18next";

import { AnnotationRpcError, SegmentationError, segmentationErrorText } from "./errors";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("segmentation errors", () => {
  it("throws English with a code and shows the active language", async () => {
    const error = new SegmentationError("errorClassHasInstances", { name: "car" });
    expect(error.message).toBe("Class car still has instances and cannot be deleted");
    expect(error.code).toBe("errorClassHasInstances");
    expect(segmentationErrorText(error)).toBe(error.message);

    await i18n.changeLanguage("zh");
    expect(segmentationErrorText(error)).toBe("类别 car 仍有实例，不能删除");
    // The thrown message stays English for logs.
    expect(error.message).toBe("Class car still has instances and cannot be deleted");
  });

  it("maps an AnnotationService code to a reason and keeps the server detail", async () => {
    const error = new AnnotationRpcError("FAILED_PRECONDITION", "FAILED_PRECONDITION: locked", {
      detail: "locked",
    });
    expect(segmentationErrorText(error)).toBe(
      "The annotation service refused it in the current state (FAILED_PRECONDITION): locked",
    );
    const propagation = new AnnotationRpcError("UNAVAILABLE", "x", {
      detail: "GPU unavailable",
      operation: "propagation",
    });
    await i18n.changeLanguage("zh");
    expect(segmentationErrorText(propagation)).toBe(
      "传播失败。标注服务不可用（UNAVAILABLE）：GPU unavailable",
    );
  });

  it("names unknown codes generically and passes other errors through", () => {
    expect(segmentationErrorText(new AnnotationRpcError("42", "x", { detail: "odd" }))).toBe(
      "The annotation service returned an error (42): odd",
    );
    expect(segmentationErrorText(new Error("plain"))).toBe("plain");
    expect(segmentationErrorText("text")).toBe("text");
  });
});
