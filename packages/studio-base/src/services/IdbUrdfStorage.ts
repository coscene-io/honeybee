// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { set as idbSet, get as idbGet, createStore as idbCreateStore } from "idb-keyval";

import Log from "@foxglove/log";
import { IUrdfStorage } from "@foxglove/studio-base";

const log = Log.getLogger(__filename);

export class IdbUrdfStorage implements IUrdfStorage {
  #db = idbCreateStore("coScene-urdf", "urdf");
  #cacheFileExtensions = ["dae", "stl", "urdf", "xacro", "xml"];

  public checkUriNeedsCache(uri: string): boolean {
    const extension = uri.split(".").pop()?.toLocaleLowerCase();
    return extension != undefined && this.#cacheFileExtensions.includes(extension);
  }

  public async set(uri: string, content: Uint8Array): Promise<void> {
    try {
      await idbSet(uri, content, this.#db);
    } catch (err) {
      log.error(err);
    }
  }

  public async get(uri: string): Promise<Uint8Array | undefined> {
    try {
      return await idbGet<Uint8Array>(uri, this.#db);
    } catch (err) {
      log.error(err);
    }

    return undefined;
  }
}
