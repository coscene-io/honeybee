import { TypographyVariantsOptions } from "@mui/material/styles";
declare module "@mui/material/styles" {
    interface TypographyVariants {
        fontMonospace: string;
        fontSansSerif: string;
        fontFeatureSettings: string;
    }
    interface TypographyVariantsOptions {
        fontMonospace: string;
        fontSansSerif: string;
        fontFeatureSettings: string;
    }
}
export declare const fontSansSerif = "'Inter'";
export declare const fontMonospace = "'IBM Plex Mono'";
export declare const fontFeatureSettings: string;
export declare const typography: TypographyVariantsOptions;
