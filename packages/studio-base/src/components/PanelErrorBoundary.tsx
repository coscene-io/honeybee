// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, Link } from "@mui/material";
import { t } from "i18next";
import { Component, ErrorInfo, PropsWithChildren, ReactNode } from "react";
import { Trans } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";
import { reportError } from "@foxglove/studio-base/reportError";
import { AppError } from "@foxglove/studio-base/util/errors";

import ErrorDisplay from "./ErrorDisplay";

type Props = {
  showErrorDetails?: boolean;
  hideErrorSourceLocations?: boolean;
  onResetPanel: () => void;
  onRemovePanel: () => void;
};

type State = {
  currentError: { error: Error; errorInfo: ErrorInfo } | undefined;
};

export default class PanelErrorBoundary extends Component<PropsWithChildren<Props>, State> {
  public override state: State = {
    currentError: undefined,
  };

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    reportError(new AppError(error, errorInfo));
    this.setState({ currentError: { error, errorInfo } });
  }

  public override render(): ReactNode {
    if (this.state.currentError) {
      return (
        <ErrorDisplay
          title={t("error:panelUnexpectedError")}
          error={this.state.currentError.error}
          errorInfo={this.state.currentError.errorInfo}
          showErrorDetails={this.props.showErrorDetails}
          hideErrorSourceLocations={this.props.hideErrorSourceLocations}
          content={
            <p>
              <Trans
                i18nKey="somethingWentWrongPanel"
                ns="error"
                components={{
                  dismissLink: (
                    <Link
                      color="inherit"
                      onClick={() => {
                        this.setState({ currentError: undefined });
                      }}
                    />
                  ),
                }}
              />
            </p>
          }
          actions={
            <>
              <Stack direction="row-reverse" gap={1}>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={() => {
                    this.setState({ currentError: undefined });
                  }}
                >
                  {t("general:dismiss")}
                </Button>
                <Button
                  variant="outlined"
                  title={t("error:resetPanelSettingsToDefault")}
                  color="error"
                  onClick={() => {
                    this.setState({ currentError: undefined });
                    this.props.onResetPanel();
                  }}
                >
                  {t("error:resetPanel")}
                </Button>
                <Button
                  variant="text"
                  title={t("error:removePanelFromLayout")}
                  color="error"
                  onClick={this.props.onRemovePanel}
                >
                  {t("error:removePanel")}
                </Button>
              </Stack>
            </>
          }
        />
      );
    }
    return this.props.children;
  }
}
