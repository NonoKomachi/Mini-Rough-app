import { PickTool } from "./tool";

/** Stateless marker tool — CanvasWidget samples the composite color under the cursor itself
 * (see pickColorAt) whenever the active tool is a PickTool, so this class carries no logic. */
export class EyedropperTool implements PickTool {
  readonly kind = "eyedropper" as const;
}
