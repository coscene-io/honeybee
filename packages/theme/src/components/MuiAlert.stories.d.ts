import { AlertProps } from "@mui/material";
import { StoryObj } from "@storybook/react";
declare const _default: import("@storybook/csf").ComponentAnnotations<import("@storybook/react/dist/types-a5624094").R, AlertProps & {
    showTitle?: boolean | undefined;
}>;
export default _default;
type Story = StoryObj<AlertProps & {
    showTitle?: boolean;
}>;
export declare const StandardVariant: Story;
export declare const OutlinedVariant: Story;
export declare const FilledVariant: Story;
export declare const Description: Story;
