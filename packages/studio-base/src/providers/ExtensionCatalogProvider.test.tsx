/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook, waitFor } from "@testing-library/react";
import * as ReactDOM from "react-dom";

import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { ExtensionLoader } from "@foxglove/studio-base/services/ExtensionLoader";
import { ExtensionInfo } from "@foxglove/studio-base/types/Extensions";

import ExtensionCatalogProvider, { createLegacyReactDOMFacade } from "./ExtensionCatalogProvider";

function fakeExtension(overrides: Partial<ExtensionInfo>): ExtensionInfo {
  return {
    id: "id",
    description: "description",
    displayName: "display name",
    homepage: "homepage",
    keywords: ["keyword1", "keyword2"],
    license: "license",
    name: "name",
    namespace: "local",
    publisher: "publisher",
    qualifiedName: "qualified name",
    version: "1",
    ...overrides,
  };
}

describe("ExtensionCatalogProvider", () => {
  it("keeps modern react-dom exports while adapting legacy roots per container", async () => {
    const render = jest.fn();
    const unmount = jest.fn();
    const createRoot = jest.fn(() => ({ render, unmount }));
    const createPortal = jest.fn();
    const flushSync = jest.fn((callback: () => void) => {
      callback();
    });
    const modernReactDOM = { createPortal, flushSync } as unknown as typeof ReactDOM;
    const facade = createLegacyReactDOMFacade(modernReactDOM, createRoot);
    const container = document.createElement("div");
    const callback = jest.fn();

    facade.render("first", container, callback);
    facade.render("second", container);
    await Promise.resolve();

    expect(facade.createPortal).toBe(createPortal);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
    expect(flushSync).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(1, "first");
    expect(render).toHaveBeenNthCalledWith(2, "second");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(facade.unmountComponentAtNode(document.createElement("div"))).toBe(false);
    expect(facade.unmountComponentAtNode(container)).toBe(true);
    await Promise.resolve();
    expect(unmount).toHaveBeenCalledTimes(1);

    facade.render("third", container);
    await Promise.resolve();
    expect(createRoot).toHaveBeenCalledTimes(2);
  });

  it("should load an extension from the loaders", async () => {
    const source = `
        module.exports = { activate: function() { return 1; } }
    `;

    const loadExtension = jest.fn().mockResolvedValue(source);
    const mockPrivateLoader: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest
        .fn()
        .mockResolvedValue([fakeExtension({ namespace: "org", name: "sample", version: "1" })]),
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      initialProps: {},
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[mockPrivateLoader]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(loadExtension).toHaveBeenCalledTimes(1);
    });
    expect(result.current.installedExtensions).toEqual([
      {
        description: "description",
        displayName: "display name",
        homepage: "homepage",
        id: "id",
        keywords: ["keyword1", "keyword2"],
        license: "license",
        name: "sample",
        namespace: "org",
        publisher: "publisher",
        qualifiedName: "qualified name",
        version: "1",
      },
    ]);
  });

  it("provides React 19 JSX and client entrypoints to extensions", async () => {
    const source = `
      module.exports = {
        activate: function(ctx) {
          const jsxRuntime = require("react/jsx-runtime");
          const jsxDevRuntime = require("react/jsx-dev-runtime");
          const reactDOM = require("react-dom");
          const reactDOMClient = require("react-dom/client");
          ctx.registerMessageConverter({
            fromSchemaName: "from.Schema",
            toSchemaName: "to.Schema",
            converter: function() {
              return {
                createPortal: typeof reactDOM.createPortal,
                createRoot: typeof reactDOMClient.createRoot,
                jsx: typeof jsxRuntime.jsx,
                jsxDEV: typeof jsxDevRuntime.jsxDEV,
                legacyRender: typeof reactDOM.render,
                legacyUnmount: typeof reactDOM.unmountComponentAtNode,
              };
            },
          });
        },
      };
    `;
    const mockPrivateLoader: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest
        .fn()
        .mockResolvedValue([fakeExtension({ namespace: "org", name: "sample", version: "1" })]),
      loadExtension: jest.fn().mockResolvedValue(source),
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      initialProps: {},
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[mockPrivateLoader]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.installedMessageConverters).toHaveLength(1);
    });
    const converter = result.current.installedMessageConverters?.[0]?.converter;
    if (converter == undefined) {
      throw new Error("Expected the extension to register a message converter");
    }
    expect(converter(undefined, undefined as never)).toEqual({
      createPortal: "function",
      createRoot: "function",
      jsx: "function",
      jsxDEV: "function",
      legacyRender: "function",
      legacyUnmount: "function",
    });
  });

  it("handles extensions with the same id in different loaders", async () => {
    const source1 = `
        module.exports = { activate: function() { return 1; } }
    `;
    const source2 = `
        module.exports = { activate: function() { return 2; } }
    `;

    const loadExtension1 = jest.fn().mockResolvedValue(source1);
    const loadExtension2 = jest.fn().mockResolvedValue(source2);
    const mockPrivateLoader1: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest
        .fn()
        .mockResolvedValue([fakeExtension({ namespace: "org", name: "sample", version: "1" })]),
      loadExtension: loadExtension1,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };
    const mockPrivateLoader2: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest
        .fn()
        .mockResolvedValue([fakeExtension({ namespace: "local", name: "sample", version: "2" })]),
      loadExtension: loadExtension2,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      initialProps: {},
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[mockPrivateLoader1, mockPrivateLoader2]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(loadExtension1).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(loadExtension2).toHaveBeenCalledTimes(1);
    });
    expect(result.current.installedExtensions).toEqual([
      {
        description: "description",
        displayName: "display name",
        homepage: "homepage",
        id: "id",
        keywords: ["keyword1", "keyword2"],
        license: "license",
        name: "sample",
        namespace: "org",
        publisher: "publisher",
        qualifiedName: "qualified name",
        version: "1",
      },
      {
        description: "description",
        displayName: "display name",
        homepage: "homepage",
        id: "id",
        keywords: ["keyword1", "keyword2"],
        license: "license",
        name: "sample",
        namespace: "local",
        publisher: "publisher",
        qualifiedName: "qualified name",
        version: "2",
      },
    ]);
  });

  it("should register a message converter", async () => {
    const source = `
        module.exports = {
            activate: function(ctx) {
                ctx.registerMessageConverter({
                    fromSchemaName: "from.Schema",
                    toSchemaName: "to.Schema",
                    converter: (msg) => msg,
                })
            }
        }
    `;

    const loadExtension = jest.fn().mockResolvedValue(source);
    const mockPrivateLoader: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest
        .fn()
        .mockResolvedValue([fakeExtension({ namespace: "org", name: "sample", version: "1" })]),
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      initialProps: {},
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[mockPrivateLoader]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(loadExtension).toHaveBeenCalledTimes(1);
    });

    expect(result.current.installedMessageConverters).toEqual([
      {
        fromSchemaName: "from.Schema",
        extensionNamespace: "org",
        toSchemaName: "to.Schema",
        converter: expect.any(Function),
      },
    ]);
  });

  it("should register topic aliases", async () => {
    const source = `
        module.exports = {
            activate: function(ctx) {
                ctx.registerTopicAliases(() => {
                    return [];
                })
            }
        }
    `;

    const loadExtension = jest.fn().mockResolvedValue(source);
    const mockPrivateLoader: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest
        .fn()
        .mockResolvedValue([fakeExtension({ namespace: "org", name: "sample", version: "1" })]),
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      initialProps: {},
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[mockPrivateLoader]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(loadExtension).toHaveBeenCalledTimes(1);
    });
    expect(result.current.installedTopicAliasFunctions).toEqual([
      { extensionId: "id", aliasFunction: expect.any(Function) },
    ]);
  });
});
