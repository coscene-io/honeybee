// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from 'react';
import { useCookies } from 'react-cookie';
// import { useNavigate } from 'react-router-dom';

import { AUTH_STATUS_COOKIE_NAME, AuthStatus } from './constant';

function AuthSignOutListener(): JSX.Element {
  const [cookies] = useCookies([AUTH_STATUS_COOKIE_NAME]);
  const status = cookies.coSceneAuthStatus?.status;
  const signOut = status === AuthStatus.SIGN_OUT;
  // const navigate = useNavigate();

  useEffect(() => {
    if (signOut) {
      window.location.href = '/login';
      // navigate('/login');
    }
  }, [ signOut]);

  return <></>;
}

export { AuthSignOutListener };
