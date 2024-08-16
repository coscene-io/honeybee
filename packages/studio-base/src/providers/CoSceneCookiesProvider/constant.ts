// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export enum AuthStatus {
  LOGGED_IN = "LOGGED_IN",
  SIGN_OUT = "SIGN_OUT",
}

export const cookieSetOptions = {
  path: "/",
  domain: window.location.hostname.split(".").slice(-2).join("."),
  secure: true,
  sameSite: "none" as boolean | "none" | "lax" | "strict" | undefined,
};
