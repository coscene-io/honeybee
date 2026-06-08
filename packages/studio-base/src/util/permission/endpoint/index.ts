// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Endpoint } from "../endpoints";
import { default as EndpointDataplatformV1alph1 } from "./dataplatform/v1alpha1/Endpoint";
import { default as EndpointDataplatformV1alph2 } from "./dataplatform/v1alpha2/Endpoint";
import { default as EndpointDataplatformV1alph3 } from "./dataplatform/v1alpha3/Endpoint";
import { default as EndpointDatastorageV1alph1 } from "./datastorage/v1alpha1/Endpoints";
import { default as EndpointMatrixV1alph1 } from "./matrix/v1alpha1/Endpoint";
import { default as EndpointMatrixV1alph2 } from "./matrix/v1alpha2/Endpoint";

export type Endpoints =
  | Endpoint
  | EndpointMatrixV1alph1
  | EndpointMatrixV1alph2
  | EndpointDataplatformV1alph1
  | EndpointDataplatformV1alph2
  | EndpointDataplatformV1alph3
  | EndpointDatastorageV1alph1;

const checkPermissionList = (permissionCode: Endpoints, permissionList: string[]) => {
  let hasPermission = false;

  permissionList.forEach((permission) => {
    const rx = permission
      .replace(".", "\\.")
      .replace("*", ".*")
      .replace("?", ".")
      .replaceAll("\\[([^\\]\\[]*)]", "($1)")
      .replaceAll("<([^<>]+)>", "(?:(?!$1)[^.])*")
      .replace(",", "|");
    const regex = new RegExp("^" + rx + "$");

    if (regex.test(permissionCode)) {
      hasPermission = true;
    }
  });

  return hasPermission;
};

function checkUserPermission(
  permissionCode: Endpoints | undefined,
  allPermissionList: {
    orgPermissionList: string[];
    projectPermissionList: string[];
    orgDenyList: string[];
    projectDenyList: string[];
  },
  permissionType: "org" | "project" | "max" | "noCheck" = "project",
): boolean {
  if (permissionCode == undefined) {
    return true;
  }

  const { orgPermissionList, projectPermissionList, orgDenyList, projectDenyList } =
    allPermissionList;

  let permissionList: string[] = [];
  let denyList: string[] = [];
  switch (permissionType) {
    case "org":
      permissionList = orgPermissionList;
      denyList = orgDenyList;
      break;
    case "project":
      permissionList = projectPermissionList;
      denyList = projectDenyList;
      break;
  }

  if (permissionType === "noCheck") {
    return true;
  }

  return (
    checkPermissionList(permissionCode, permissionList) &&
    !checkPermissionList(permissionCode, denyList)
  );
}

export {
  Endpoint,
  EndpointDataplatformV1alph1,
  EndpointDataplatformV1alph2,
  EndpointDataplatformV1alph3,
  EndpointMatrixV1alph1,
  EndpointMatrixV1alph2,
  EndpointDatastorageV1alph1,
  checkUserPermission,
};
