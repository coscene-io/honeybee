// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider as FluentThemeProvider } from "@fluentui/react";
import { registerIcons, unregisterIcons } from "@fluentui/style-utilities";
import { ThemeProvider as MuiThemeProvider } from "@mui/material";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { createMuiTheme, createFluentTheme } from "@foxglove/studio-base/theme";

import icons from "./icons";

// Make sure mui styles are loaded first so that our makeStyles customizations
// take precedence.
const muiCache = createCache({
  key: "mui",
  prepend: true,
});

// By default the ThemeProvider adds an extra div to the DOM tree. We can disable this with a
// custom `as` component to FluentThemeProvider. The component must support a `ref` property
// otherwise we get react warnings.
const ThemeContainer = React.forwardRef((props, _ref) => <>{props.children}</>);
ThemeContainer.displayName = "ThemeContainer";

export default function ThemeProvider({
  children,
  isDark,
}: React.PropsWithChildren<{ isDark: boolean }>): React.ReactElement | ReactNull {
  // Icons need to be registered before other components are rendered. But we need to register them in an effect so that hot module reloading can run cleanups in the right order when the ThemeProvider is replaced. So we render nothing until after we've registered them.
  const [iconsRegistered, setIconsRegistered] = useState(false);

  useEffect(() => {
    // Trick CodeEditor into sync with our theme
    document.documentElement.setAttribute("data-color-mode", isDark ? "dark" : "light");
  }, [isDark]);

  useLayoutEffect(() => {
    if (iconsRegistered) {
      return () => unregisterIcons(Object.keys(icons));
    }
    registerIcons({ icons });
    setIconsRegistered(true);
    return undefined;
  }, [iconsRegistered]);

  const muiTheme = useMemo(() => createMuiTheme(isDark ? "dark" : "light"), [isDark]);
  const fluentTheme = useMemo(() => createFluentTheme({ isInverted: isDark }), [isDark]);

  useLayoutEffect(() => {
    // Set the theme color to match the sidebar and playback bar
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = muiTheme.palette.background.paper;
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [muiTheme]);

  if (!iconsRegistered) {
    return ReactNull;
  }

  return (
    <CacheProvider value={muiCache}>
      <MuiThemeProvider theme={muiTheme}>
        <FluentThemeProvider
          as={ThemeContainer}
          applyTo="none" // skip default global styles for now
          theme={fluentTheme}
        >
          {children}
        </FluentThemeProvider>
      </MuiThemeProvider>
    </CacheProvider>
  );
}
