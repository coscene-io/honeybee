/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";
import { createInstance } from "i18next";
import { StrictMode } from "react";
import type { PropsWithChildren } from "react";
import { Trans } from "react-i18next";

async function createTranslations() {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    defaultNS: "general",
    resources: {
      en: {
        general: {
          apply: "Open <Link>first</Link> or <Link>second</Link>.",
          cancel: "Open <Link>updated first</Link> or <Link>updated second</Link>.",
        },
      },
    },
  });
  return i18n;
}

it.each([undefined, "explicit-component-key"])(
  "keeps repeated translated components stable without injecting refs (key=%s)",
  async (componentKey) => {
    const i18n = await createTranslations();
    const hasRef: boolean[] = [];
    function Link(props: PropsWithChildren<{ href: string; target: string }>) {
      hasRef.push(Object.hasOwn(props, "ref"));
      return (
        <a href={props.href} target={props.target}>
          {props.children}
        </a>
      );
    }
    const components = { Link: <Link key={componentKey} href="#example" target="_self" /> };
    const view = render(
      <StrictMode>
        <Trans i18n={i18n} i18nKey="apply" components={components} />
      </StrictMode>,
    );
    const initialLinks = view.getAllByRole("link");
    expect(initialLinks.map((link) => link.textContent)).toEqual(["first", "second"]);
    view.rerender(
      <StrictMode>
        <Trans i18n={i18n} i18nKey="cancel" components={components} />
      </StrictMode>,
    );
    const updatedLinks = view.getAllByRole("link");
    expect(updatedLinks[0]).toBe(initialLinks[0]);
    expect(updatedLinks[1]).toBe(initialLinks[1]);
    expect(updatedLinks.map((link) => link.textContent)).toEqual([
      "updated first",
      "updated second",
    ]);
    expect(hasRef.length).toBeGreaterThan(0);
    expect(hasRef.every((value) => !value)).toBe(true);
  },
);

it("preserves translated callback-ref cleanup through StrictMode and text updates", async () => {
  const i18n = await createTranslations();
  const cleanup = jest.fn();
  const ref = jest.fn(() => cleanup);
  const components = { Link: <a href="#example" target="_self" ref={ref} /> };
  const view = render(
    <StrictMode>
      <Trans i18n={i18n} i18nKey="apply" components={components} />
    </StrictMode>,
  );
  const attachments = ref.mock.calls.length;
  expect(attachments).toBeGreaterThanOrEqual(2);
  view.rerender(
    <StrictMode>
      <Trans i18n={i18n} i18nKey="cancel" components={components} />
    </StrictMode>,
  );
  expect(ref).toHaveBeenCalledTimes(attachments);
  view.unmount();
  expect(cleanup).toHaveBeenCalledTimes(attachments);
});
