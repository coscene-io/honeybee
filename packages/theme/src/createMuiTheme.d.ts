import { Theme } from "@mui/material/styles";
type ThemePreference = "dark" | "light";
declare module "@mui/material/styles" {
    interface Theme {
        name?: ThemePreference;
    }
    interface ThemeOptions {
        name?: ThemePreference;
    }
}
export declare const createMuiTheme: (themePreference: ThemePreference, lang: string) => Theme;
export {};
