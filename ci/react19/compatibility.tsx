// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Compile real public declarations without skipLibCheck so patched dependencies cannot silently
// fall back to the removed global JSX namespace or React 18 component/ref types.
import { useRef } from "react";
import { useDrag } from "react-dnd";
import { Trans, useTranslation } from "react-i18next";
import JSONTree from "react-json-tree";
import { Mosaic, MosaicWindow } from "react-mosaic-component";
import { Panel, Group } from "react-resizable-panels";
import { useThrottle } from "react-use";
import { FixedSizeList } from "react-window";
import { useImmer } from "use-immer";

export function React19Compatibility(): React.JSX.Element {
  const { t } = useTranslation();
  // This isolated project deliberately does not import Honeybee's global ReactNull overload.
  // eslint-disable-next-line no-restricted-syntax
  const ref = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useImmer({ count: 0 });
  const count = useThrottle(value.count);
  const [, connectDrag] = useDrag(() => ({ type: "typecheck", item: { count } }), [count]);
  return (
    <Group orientation="vertical">
      <Panel>
        <Mosaic<string>
          initialValue="tree"
          renderTile={(id, path) => (
            <MosaicWindow<string> path={path} title={`${id}: ${t("apply")}`}>
              <div
                ref={(element) => {
                  ref.current = element;
                  connectDrag(element);
                }}
              >
                <Trans i18nKey="apply">Apply</Trans>
                <JSONTree
                  data={value}
                  shouldExpandNode={() => true}
                  onExpand={() => {
                    setValue((draft) => {
                      draft.count++;
                    });
                  }}
                  onCollapse={() => {
                    setValue((draft) => {
                      draft.count--;
                    });
                  }}
                />
              </div>
            </MosaicWindow>
          )}
        />
      </Panel>
      <Panel>
        <FixedSizeList height={100} width={100} itemCount={10} itemSize={20}>
          {({ index, style }) => <div style={style}>{index}</div>}
        </FixedSizeList>
      </Panel>
    </Group>
  );
}
