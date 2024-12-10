// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// This is injected by DefinePlugin from the webpack config that builds these files
declare const COSCENE_PRODUCT_NAME: string;
declare const COSCENE_PRODUCT_VERSION: string;
declare const COSCENE_PRODUCT_HOMEPAGE: string;

const productName = COSCENE_PRODUCT_NAME;
const version = COSCENE_PRODUCT_VERSION;
const homepage = COSCENE_PRODUCT_HOMEPAGE;

export {
  homepage as COSCENE_PRODUCT_HOMEPAGE,
  productName as COSCENE_PRODUCT_NAME,
  version as COSCENE_PRODUCT_VERSION,
};
