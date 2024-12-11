// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

type Mapping = Record<string, string>;

const packValue = (value: unknown, map: Mapping): unknown => {
  if (value == undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((element) => packValue(element, map));
  }

  if (value instanceof Map) {
    const transformed = new Map<string, unknown>();
    for (const [key, otherValue] of value.entries()) {
      const newKey = packValue(key, map);
      if (typeof newKey !== "string") {
        continue;
      }
      transformed.set(newKey, packValue(otherValue, map));
    }
    return transformed;
  }

  if (value instanceof Set || ArrayBuffer.isView(value)) {
    // we do not dedupe in sets or TypedArrays for now
    return value;
  }

  switch (typeof value) {
    case "object": {
      const transformed: Record<string, unknown> = {};
      for (const [key, otherValue] of Object.entries(value)) {
        const newKey = packValue(key, map);
        if (typeof newKey !== "string") {
          continue;
        }
        transformed[newKey] = packValue(otherValue, map);
      }
      return transformed;
    }
    case "string":
      if (!(value in map)) {
        map[value] = value;
      }
      // point all instances of the same string to the same reference
      return map[value];
    case "number": {
      throw new Error('Not implemented yet: "number" case');
    }
    case "bigint": {
      throw new Error('Not implemented yet: "bigint" case');
    }
    case "boolean": {
      throw new Error('Not implemented yet: "boolean" case');
    }
    case "symbol": {
      throw new Error('Not implemented yet: "symbol" case');
    }
    case "undefined": {
      throw new Error('Not implemented yet: "undefined" case');
    }
    case "function": {
      throw new Error('Not implemented yet: "function" case');
    }
    default:
      return value;
  }
};

/**
 * Deduplicate all string references in the given data structure. This is
 * useful to do after `postMessage()`, since `structuredClone()` duplicates
 * strings.
 *
 * See: https://bugs.chromium.org/p/chromium/issues/detail?id=1487682&q=&can=4
 */
export default function strPack<T>(data: T): T {
  const map: Mapping = {};
  return packValue(data, map) as T;
}
