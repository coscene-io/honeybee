// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import type { MaskConversionLoss } from "../../types";

type MaskConversionDialogProps = {
  conversion: { instanceId: string; loss: MaskConversionLoss } | undefined;
  onClose: () => void;
  onConfirm: () => void;
};

/** Confirms a lossy mask → polygons conversion, listing what it would lose. */
export const MaskConversionDialog = memo(function MaskConversionDialog({
  conversion,
  onClose,
  onConfirm,
}: MaskConversionDialogProps): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  return (
    <Dialog
      open={conversion != undefined}
      onClose={onClose}
      aria-labelledby="mask-conversion-title"
    >
      <DialogTitle id="mask-conversion-title">{t("convertMaskPolygons")}</DialogTitle>
      {conversion && (
        <DialogContent data-testid="mask-conversion-loss">
          <Typography variant="body2" gutterBottom>
            {t("conversionWarning")}
          </Typography>
          <Typography variant="body2" component="ul">
            <li>
              IoU {(conversion.loss.iou * 100).toFixed(2)}% ·{" "}
              {t("conversionPolygonCount", { polygonCount: conversion.loss.polygonCount })}
            </li>
            <li>
              {t("conversionPixelChange", {
                lostPixels: conversion.loss.lostPixels,
                addedPixels: conversion.loss.addedPixels,
              })}
            </li>
            {conversion.loss.holes > 0 && (
              <li>{t("conversionHolesFilled", { holes: conversion.loss.holes })}</li>
            )}
            {conversion.loss.droppedComponents > 0 && (
              <li>
                {t("conversionPartsDropped", {
                  droppedComponents: conversion.loss.droppedComponents,
                })}
              </li>
            )}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("conversionUndoHint")}
          </Typography>
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button variant="contained" data-testid="confirm-mask-conversion" onClick={onConfirm}>
          {t("convert")}
        </Button>
      </DialogActions>
    </Dialog>
  );
});
