// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CookiesProvider } from 'react-cookie';

import { AuthSignOutListener } from '@foxglove/studio-base/providers/CoSceneCookiesProvider/AuthSignOutListener';

import { cookieSetOptions } from './constant';

export default function CoSceneCookiesProvider({ children }: { children?: React.PropsWithChildren }): JSX.Element {
  return (
    <CookiesProvider defaultSetOptions={cookieSetOptions}>
      <AuthSignOutListener/>
      {children}
    </CookiesProvider>
  );
}
