import { Components, Theme } from "@mui/material";
export type OverrideComponentReturn<T extends keyof Components> = Components<Theme>[T];
export type Language = "en" | "zh" | "ja";
