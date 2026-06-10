import { OverrideComponentReturn } from "../types";
declare module "@mui/material/Alert" {
    interface AlertPropsColorOverrides {
        primary: true;
    }
    interface AlertClasses {
        standardPrimary: string;
        outlinedPrimary: string;
        filledPrimary: string;
    }
}
export declare const MuiAlert: OverrideComponentReturn<"MuiAlert">;
