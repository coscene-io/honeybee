/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook, waitFor } from "@testing-library/react";

import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { ExtensionLoader } from "@foxglove/studio-base/services/ExtensionLoader";
import { ExtensionInfo } from "@foxglove/studio-base/types/Extensions";

import ExtensionCatalogProvider from "./ExtensionCatalogProvider";

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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("ExtensionCatalogProvider", () => {
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
      namespace: "local",
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
    expect(loadExtension1.mock.invocationCallOrder[0]!).toBeLessThan(
      loadExtension2.mock.invocationCallOrder[0]!,
    );
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

  it("activates organization extensions before local extensions regardless of loader order", async () => {
    const source = (panelLabel: string) => `
      module.exports = {
        activate: function(ctx) {
          ctx.registerPanel({ name: "shared-panel", initPanel: function() {}, label: "${panelLabel}" });
        }
      }
    `;
    const orgLoadExtension = jest.fn().mockResolvedValue(source("org"));
    const localLoadExtension = jest.fn().mockResolvedValue(source("local"));
    const orgExtension = fakeExtension({
      id: "org-id",
      namespace: "org",
      qualifiedName: "shared",
    });
    const localExtension = fakeExtension({
      id: "local-id",
      namespace: "local",
      qualifiedName: "shared",
    });
    const orgLoader: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest.fn().mockResolvedValue([orgExtension]),
      loadExtension: orgLoadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };
    const localLoader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest.fn().mockResolvedValue([localExtension]),
      loadExtension: localLoadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[localLoader, orgLoader]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.loadState).toBe("ready");
    });

    expect(orgLoadExtension.mock.invocationCallOrder[0]!).toBeLessThan(
      localLoadExtension.mock.invocationCallOrder[0]!,
    );
    expect(result.current.installedExtensions).toEqual([orgExtension, localExtension]);
    expect(result.current.installedPanels?.["shared.shared-panel"]?.extensionNamespace).toBe(
      "local",
    );
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

  it("does not publish contributions from an extension whose activation fails", async () => {
    const source = `
      module.exports = {
        activate: function(ctx) {
          ctx.registerPanel({ name: "unsafe-partial", initPanel: function() {} });
          ctx.registerMessageConverter({
            fromSchemaName: "from.Schema",
            toSchemaName: "to.Schema",
            converter: function(msg) { return msg; },
          });
          throw new Error("activation failed");
        }
      }
    `;
    const loader: ExtensionLoader = {
      namespace: "org",
      getExtensions: jest.fn().mockResolvedValue([fakeExtension({ namespace: "org" })]),
      loadExtension: jest.fn().mockResolvedValue(source),
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.loadState).toBe("degraded");
    });
    expect(result.current.loadErrors).toEqual([
      expect.objectContaining({ stage: "activate", extensionId: "id" }),
    ]);
    expect(result.current.installedPanels).toEqual({});
    expect(result.current.installedMessageConverters).toEqual([]);
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
  });

  it("publishes a partial catalog when one loader misses the shared list deadline", async () => {
    jest.useFakeTimers();
    const source = `module.exports = { activate: function() {} }`;
    const never = new Promise<ExtensionInfo[]>(() => {});
    const localExtension = fakeExtension({ id: "local-id", namespace: "local" });
    const orgGetExtensions = jest.fn().mockReturnValue(never);
    const localGetExtensions = jest.fn().mockResolvedValue([localExtension]);
    const localLoadExtension = jest.fn().mockResolvedValue(source);
    const orgLoader: ExtensionLoader = {
      namespace: "org",
      getExtensions: orgGetExtensions,
      loadExtension: jest.fn(),
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };
    const localLoader: ExtensionLoader = {
      namespace: "local",
      getExtensions: localGetExtensions,
      loadExtension: localLoadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    try {
      const { result } = renderHook(() => useExtensionCatalog((state) => state), {
        wrapper: ({ children }) => (
          <ExtensionCatalogProvider loaders={[orgLoader, localLoader]}>
            {children}
          </ExtensionCatalogProvider>
        ),
      });

      expect(result.current.loadState).toBe("loading");
      await act(async () => {
        await Promise.resolve();
      });
      expect(orgGetExtensions).toHaveBeenCalledTimes(1);
      expect(localGetExtensions).toHaveBeenCalledTimes(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });

      expect(result.current.loadState).toBe("degraded");
      expect(result.current.installedExtensions).toEqual([localExtension]);
      expect(localLoadExtension).toHaveBeenCalledWith("local-id");
      expect(result.current.loadErrors).toEqual([
        {
          namespace: "org",
          stage: "list",
          extensionId: undefined,
          message: "Timed out listing extensions",
          timedOut: true,
        },
      ]);
      expect(console.error).toHaveBeenCalled();
    } finally {
      jest.mocked(console.error).mockClear();
      jest.useRealTimers();
    }
  });

  it("degrades only the extension whose source misses its deadline", async () => {
    jest.useFakeTimers();
    const stuckExtension = fakeExtension({ id: "stuck" });
    const healthyExtension = fakeExtension({ id: "healthy" });
    const loadExtension = jest
      .fn()
      .mockReturnValueOnce(new Promise<string>(() => {}))
      .mockResolvedValueOnce(`module.exports = { activate: function() {} }`);
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest.fn().mockResolvedValue([stuckExtension, healthyExtension]),
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    try {
      const { result } = renderHook(() => useExtensionCatalog((state) => state), {
        wrapper: ({ children }) => (
          <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
        ),
      });

      await act(async () => {
        await Promise.resolve();
      });
      expect(loadExtension).toHaveBeenNthCalledWith(1, "stuck");
      expect(loadExtension).toHaveBeenNthCalledWith(2, "healthy");

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });

      expect(result.current.installedExtensions).toEqual([stuckExtension, healthyExtension]);
      expect(result.current.loadState).toBe("degraded");
      expect(result.current.loadErrors).toEqual([
        {
          namespace: "local",
          stage: "load",
          extensionId: "stuck",
          message: "Timed out loading extension stuck",
          timedOut: true,
        },
      ]);
      expect(console.error).toHaveBeenCalled();
    } finally {
      jest.mocked(console.error).mockClear();
      jest.useRealTimers();
    }
  });

  it("publishes a retryable degraded state after an unexpected loader result", async () => {
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest.fn().mockResolvedValue({ malformed: true } as unknown as ExtensionInfo[]),
      loadExtension: jest.fn(),
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.loadState).toBe("degraded");
    });
    expect(result.current.loadErrors).toEqual([
      expect.objectContaining({ namespace: "local", stage: "list", timedOut: false }),
    ]);
    expect(result.current.installedPanels).toEqual({});
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
  });

  it("uses the source-hash fallback when Web Crypto is unavailable", async () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    const extension = fakeExtension({ namespace: "local" });
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest.fn().mockResolvedValue([extension]),
      loadExtension: jest.fn().mockResolvedValue(`module.exports = { activate: function() {} }`),
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    try {
      const { result } = renderHook(() => useExtensionCatalog((state) => state), {
        wrapper: ({ children }) => (
          <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.loadState).toBe("ready");
      });
      expect(result.current.installedExtensions).toEqual([extension]);
      expect(result.current.loadErrors).toEqual([]);
    } finally {
      if (cryptoDescriptor != undefined) {
        Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      } else {
        delete (globalThis as { crypto?: Crypto }).crypto;
      }
    }
  });

  it("applies extension source deadlines concurrently", async () => {
    jest.useFakeTimers();
    const extensions = Array.from({ length: 8 }, (_, index) =>
      fakeExtension({ id: `extension-${index}` }),
    );
    const loadExtension = jest.fn().mockReturnValue(new Promise<string>(() => {}));
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest.fn().mockResolvedValue(extensions),
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    try {
      const { result } = renderHook(() => useExtensionCatalog((state) => state), {
        wrapper: ({ children }) => (
          <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
        ),
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(loadExtension).toHaveBeenCalledTimes(extensions.length);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      expect(result.current.loadState).toBe("degraded");
      expect(result.current.loadErrors).toHaveLength(extensions.length);
    } finally {
      jest.mocked(console.error).mockClear();
      jest.useRealTimers();
    }
  });

  it("reuses a complete activation snapshot when the source revision is unchanged", async () => {
    const extension = fakeExtension({ id: "snapshot", qualifiedName: "snapshot" });
    const source = `
      module.exports = {
        activate: function(ctx) {
          const marker = {};
          ctx.registerPanel({ name: "panel", initPanel: function() { return marker; } });
          ctx.registerMessageConverter({
            fromSchemaName: "from.Schema",
            toSchemaName: "to.Schema",
            converter: function() { return marker; },
          });
          ctx.registerTopicAliases(function() { return [marker]; });
        }
      }
    `;
    const loadExtension = jest.fn().mockResolvedValue(source);
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest.fn().mockResolvedValue([extension]),
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.loadState).toBe("ready");
    });
    const firstPanel = result.current.installedPanels?.["snapshot.panel"];
    const firstConverter = result.current.installedMessageConverters?.[0];
    const firstAlias = result.current.installedTopicAliasFunctions?.[0];

    await act(async () => {
      await result.current.refreshExtensions();
    });

    expect(result.current.installedPanels?.["snapshot.panel"]).toBe(firstPanel);
    expect(result.current.installedMessageConverters?.[0]).toBe(firstConverter);
    expect(result.current.installedTopicAliasFunctions?.[0]).toBe(firstAlias);
    expect(loadExtension).toHaveBeenCalledTimes(2);
  });

  it("reactivates an extension when activation-relevant metadata changes", async () => {
    const firstExtension = fakeExtension({ id: "metadata", qualifiedName: "before" });
    const secondExtension = { ...firstExtension, qualifiedName: "after" };
    const source = `
      module.exports = {
        activate: function(ctx) {
          ctx.registerPanel({ name: "panel", initPanel: function() {} });
        }
      }
    `;
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest
        .fn()
        .mockResolvedValueOnce([firstExtension])
        .mockResolvedValue([secondExtension]),
      loadExtension: jest.fn().mockResolvedValue(source),
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.installedPanels?.["before.panel"]).toBeDefined();
    });
    const firstPanel = result.current.installedPanels?.["before.panel"];

    await act(async () => {
      await result.current.refreshExtensions();
    });

    expect(result.current.installedPanels?.["before.panel"]).toBeUndefined();
    expect(result.current.installedPanels?.["after.panel"]).toBeDefined();
    expect(result.current.installedPanels?.["after.panel"]).not.toBe(firstPanel);
  });

  it("retains the last-known-good snapshot when a source load fails", async () => {
    const extension = fakeExtension({ id: "retained", qualifiedName: "retained" });
    const source = `
      module.exports = {
        activate: function(ctx) {
          ctx.registerPanel({ name: "panel", initPanel: function() {} });
          ctx.registerMessageConverter({
            fromSchemaName: "from.Schema",
            toSchemaName: "to.Schema",
            converter: function(message) { return message; },
          });
        }
      }
    `;
    const loadExtension = jest
      .fn()
      .mockResolvedValueOnce(source)
      .mockRejectedValueOnce(new Error("temporary load failure"));
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions: jest.fn().mockResolvedValue([extension]),
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.loadState).toBe("ready");
    });
    const firstPanel = result.current.installedPanels?.["retained.panel"];
    const firstConverter = result.current.installedMessageConverters?.[0];

    await act(async () => {
      await result.current.refreshExtensions();
    });

    expect(result.current.loadState).toBe("degraded");
    expect(result.current.loadErrors).toEqual([
      expect.objectContaining({ stage: "load", extensionId: "retained" }),
    ]);
    expect(result.current.installedExtensions).toEqual([extension]);
    expect(result.current.installedPanels?.["retained.panel"]).toBe(firstPanel);
    expect(result.current.installedMessageConverters?.[0]).toBe(firstConverter);
    jest.mocked(console.error).mockClear();
  });

  it("retains the last-known-good snapshot after list and activation failures until uninstall is confirmed", async () => {
    const extension = fakeExtension({ id: "retained", qualifiedName: "retained" });
    const goodSource = `
      module.exports = {
        activate: function(ctx) {
          ctx.registerPanel({ name: "panel", initPanel: function() {} });
        }
      }
    `;
    const brokenSource = `
      module.exports = {
        activate: function() {
          throw new Error("temporary activation failure");
        }
      }
    `;
    const getExtensions = jest
      .fn()
      .mockResolvedValueOnce([extension])
      .mockRejectedValueOnce(new Error("temporary list failure"))
      .mockResolvedValueOnce([extension])
      .mockResolvedValueOnce([]);
    const loadExtension = jest
      .fn()
      .mockResolvedValueOnce(goodSource)
      .mockResolvedValueOnce(brokenSource);
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions,
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.loadState).toBe("ready");
    });
    const firstPanel = result.current.installedPanels?.["retained.panel"];

    await act(async () => {
      await result.current.refreshExtensions();
    });
    expect(result.current.loadState).toBe("degraded");
    expect(result.current.loadErrors).toEqual([
      expect.objectContaining({ stage: "list", namespace: "local" }),
    ]);
    expect(result.current.installedExtensions).toEqual([extension]);
    expect(result.current.installedPanels?.["retained.panel"]).toBe(firstPanel);

    await act(async () => {
      await result.current.refreshExtensions();
    });
    expect(result.current.loadState).toBe("degraded");
    expect(result.current.loadErrors).toEqual([
      expect.objectContaining({ stage: "activate", extensionId: "retained" }),
    ]);
    expect(result.current.installedPanels?.["retained.panel"]).toBe(firstPanel);

    await act(async () => {
      await result.current.refreshExtensions();
    });
    expect(result.current.loadState).toBe("ready");
    expect(result.current.installedExtensions).toEqual([]);
    expect(result.current.installedPanels).toEqual({});
    expect(result.current.installedMessageConverters).toEqual([]);
    jest.mocked(console.error).mockClear();
  });

  it("coalesces overlapping refreshes and resolves callers after the pending rerun publishes", async () => {
    const firstList = deferred<ExtensionInfo[]>();
    const latestList = deferred<ExtensionInfo[]>();
    const staleExtension = fakeExtension({ id: "stale", version: "1" });
    const latestExtension = fakeExtension({ id: "latest", version: "2" });
    const getExtensions = jest
      .fn()
      .mockReturnValueOnce(firstList.promise)
      .mockReturnValueOnce(latestList.promise);
    const loadExtension = jest
      .fn()
      .mockResolvedValue(`module.exports = { activate: function() {} }`);
    const loader: ExtensionLoader = {
      namespace: "local",
      getExtensions,
      loadExtension,
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
    };

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[loader]}>{children}</ExtensionCatalogProvider>
      ),
    });

    await waitFor(() => {
      expect(getExtensions).toHaveBeenCalledTimes(1);
    });
    let firstCallerResolved = false;
    let secondCallerResolved = false;
    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    act(() => {
      firstRefresh = result.current.refreshExtensions().then(() => {
        firstCallerResolved = true;
      });
      secondRefresh = result.current.refreshExtensions().then(() => {
        secondCallerResolved = true;
      });
    });

    await act(async () => {
      firstList.resolve([staleExtension]);
      await firstList.promise;
    });
    await waitFor(() => {
      expect(getExtensions).toHaveBeenCalledTimes(2);
    });
    expect(firstCallerResolved).toBe(false);
    expect(secondCallerResolved).toBe(false);
    expect(result.current.installedExtensions).toBeUndefined();
    expect(result.current.loadState).toBe("loading");

    await act(async () => {
      latestList.resolve([latestExtension]);
      await Promise.all([firstRefresh, secondRefresh]);
    });
    expect(result.current.installedExtensions).toEqual([latestExtension]);
    expect(result.current.loadState).toBe("ready");
    expect(firstCallerResolved).toBe(true);
    expect(secondCallerResolved).toBe(true);
    expect(getExtensions).toHaveBeenCalledTimes(2);
    expect(loadExtension).toHaveBeenCalledTimes(2);
  });
});
