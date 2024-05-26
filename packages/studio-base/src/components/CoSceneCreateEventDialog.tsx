// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Dialog } from "@mui/material";

import {
  CoSceneCreateEventContainer,
  ToModifyEvent as ToModifyEventContainer,
} from "@foxglove/studio-base/components/CoSceneCreateEventContainer";

export type ToModifyEvent = ToModifyEventContainer;

export function CoSceneCreateEventDialog(props: {
  onClose: () => void;
  toModifyEvent?: ToModifyEvent;
}): JSX.Element {
  return (
    <Dialog open onClose={props.onClose} maxWidth="sm" fullWidth>
      <CoSceneCreateEventContainer {...props} />
    </Dialog>
  );
}
