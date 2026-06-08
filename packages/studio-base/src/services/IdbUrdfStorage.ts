// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { set as idbSet, get as idbGet, createStore as idbCreateStore } from "idb-keyval";

import Log from "@foxglove/log";
import { IUrdfStorage } from "@foxglove/studio-base";

const log = Log.getLogger(__filename);

type StoredUrdfItem = {
  etag: string;
  content: Uint8Array;
};

export class IdbUrdfStorage implements IUrdfStorage {
  #db = idbCreateStore("coScene-urdf", "urdf");
  #cacheFileExtensions = ["dae", "stl", "urdf", "xacro", "xml"];

  public checkUriNeedsCache(uri: string): boolean {
    const extension = uri.split(".").pop()?.toLocaleLowerCase();
    return extension != undefined && this.#cacheFileExtensions.includes(extension);
  }

  public async set(url: string, etag: string, content: Uint8Array): Promise<void> {
    try {
      const item: StoredUrdfItem = { etag, content };
      await idbSet(url, item, this.#db);
    } catch (err) {
      log.error(err);
    }
  }

  public async getEtag(url: string): Promise<string | undefined> {
    try {
      const item = await idbGet<StoredUrdfItem>(url, this.#db);
      return item?.etag;
    } catch {
      return undefined;
    }
  }

  public async getFile(url: string): Promise<Uint8Array | undefined> {
    try {
      const item = await idbGet<StoredUrdfItem>(url, this.#db);
      return item?.content;
    } catch (err) {
      log.error(err);
    }

    return undefined;
  }
}
