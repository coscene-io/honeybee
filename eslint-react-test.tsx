// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// This file is not used in the app. It provides stable, on-disk violations for testing residual
// ESLint rules that need TypeScript project information or a TSX file.

import { useAsync } from "react-use";
import { makeStyles } from "tss-react/mui";

export function booleanParameter(
  // eslint-disable-next-line @coscene-io/no-boolean-parameters
  enabled: boolean,
): boolean {
  return enabled;
}

export function ResidualLintFixture({
  fallback,
  value,
}: {
  fallback: string | undefined;
  value: string;
}): React.JSX.Element {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const displayValue = fallback || "fallback";

  useAsync(
    () => {
      console.debug(value);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useAsyncAppConfigurationValue(() => {
    console.debug(value);
  }, []);

  /* eslint-disable react/jsx-curly-brace-presence */
  return (
    <div>
      {displayValue}
      {"value"}
    </div>
  );
  /* eslint-enable react/jsx-curly-brace-presence */
}

const useStyles = makeStyles()({
  // eslint-disable-next-line tss-unused-classes/unused-classes
  unused: {},
});
void useStyles;

declare function useAsyncAppConfigurationValue(
  callback: () => void,
  dependencies: readonly unknown[],
): void;
