// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

enum Endpoint {
  CreateLabel = "coscene.dataplatform.v1alpha1.services.LabelService.CreateLabel",
  DeleteLabel = "coscene.dataplatform.v1alpha1.services.LabelService.DeleteLabel",
  GetLabel = "coscene.dataplatform.v1alpha1.services.LabelService.GetLabel",
  ListLabels = "coscene.dataplatform.v1alpha1.services.LabelService.ListLabels",
  UpdateLabel = "coscene.dataplatform.v1alpha1.services.LabelService.UpdateLabel",

  AssignOrganizationRole = "coscene.dataplatform.v1alpha1.services.RoleService.AssignOrganizationRole",
  AssignProjectRole = "coscene.dataplatform.v1alpha1.services.RoleService.AssignProjectRole",
  AssignWarehouseRole = "coscene.dataplatform.v1alpha1.services.RoleService.AssignWarehouseRole",
  BatchAssignProjectRole = "coscene.dataplatform.v1alpha1.services.RoleService.BatchAssignProjectRole",
  BatchGetTeamRoles = "coscene.dataplatform.v1alpha1.services.RoleService.BatchGetTeamRoles",
  BatchGetUserRoles = "coscene.dataplatform.v1alpha1.services.RoleService.BatchGetUserRoles",
  ChangeProjectVisibility = "coscene.dataplatform.v1alpha1.services.ProjectService.ChangeProjectVisibility",
  CreateRole = "coscene.dataplatform.v1alpha1.services.RoleService.CreateRole",
  GetRole = "coscene.dataplatform.v1alpha1.services.RoleService.GetRole",
  ListRoles = "coscene.dataplatform.v1alpha1.services.RoleService.ListRoles",
  UnassignedOrganizationRole = "coscene.dataplatform.v1alpha1.services.RoleService.UnassignedOrganizationRole",
  UnassignedProjectRole = "coscene.dataplatform.v1alpha1.services.RoleService.UnassignedProjectRole",
  UnassignedWarehouseRole = "coscene.dataplatform.v1alpha1.services.RoleService.UnassignedWarehouseRole",
  UpdateRole = "coscene.dataplatform.v1alpha1.services.RoleService.UpdateRole",

  GetVersion = "coscene.dataplatform.v1alpha1.services.VersionService.GetVersion",

  ListOrganizationSubscriptions = "coscene.dataplatform.v1alpha1.services.SubscriptionService.ListOrganizationSubscriptions",
}

export default Endpoint;
