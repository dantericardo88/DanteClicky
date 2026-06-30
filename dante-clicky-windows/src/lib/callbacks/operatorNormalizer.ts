import type { AgentCallbackHandler } from "../agentCallbacks";

export type RawComputerCallAction = Record<string, unknown>;

const MOUSE_BUTTONS = ["left", "right", "wheel", "back", "forward"] as const;
const KEYPRESS_ALIASES = ["hotkey", "key", "press", "key_press"] as const;
const KEYS_FIELD_ALIASES = ["keypress", "key", "press", "key_press", "text"] as const;

const REQUIRED_KEYS_BY_TYPE: Record<string, readonly string[]> = {
  click: ["type", "button", "x", "y"],
  double_click: ["type", "x", "y"],
  drag: ["type", "path"],
  keypress: ["type", "keys"],
  move: ["type", "x", "y"],
  screenshot: ["type"],
  scroll: ["type", "scroll_x", "scroll_y", "x", "y"],
  type: ["type", "text"],
  wait: ["type"],
  left_mouse_down: ["type", "x", "y"],
  left_mouse_up: ["type", "x", "y"],
  triple_click: ["type", "button", "x", "y"],
};

export function normalizeComputerCallAction(
  input: RawComputerCallAction
): RawComputerCallAction {
  const action: RawComputerCallAction = { ...input };

  const initialType = typeof action.type === "string" ? action.type : "";
  for (const button of MOUSE_BUTTONS) {
    if (initialType === `${button}_click`) {
      action.type = "click";
      action.button = button;
    }
  }

  if (typeof action.type === "string") {
    for (const alias of KEYPRESS_ALIASES) {
      if (action.type === alias) {
        action.type = "keypress";
        break;
      }
    }
  }

  if (typeof action.type !== "string" || action.type === "") {
    if ("button" in action) action.type = "click";
    else if ("click" in action) action.type = "click";
    else if ("scroll_x" in action || "scroll_y" in action) action.type = "scroll";
    else if ("text" in action) action.type = "type";
  }

  const coordinate = action.coordinate;
  if (Array.isArray(coordinate) && coordinate.length >= 2) {
    action.x = coordinate[0];
    action.y = coordinate[1];
    delete action.coordinate;
  }

  const actionType = typeof action.type === "string" ? action.type : "";

  if (actionType === "click") {
    if (!("button" in action) && "click" in action) {
      action.button = action.click;
      delete action.click;
    }
    if (!("button" in action) || typeof action.button !== "string") {
      action.button = "left";
    }
  }

  if (actionType === "scroll") {
    if (typeof action.scroll_x !== "number") action.scroll_x = 0;
    if (typeof action.scroll_y !== "number") action.scroll_y = 0;
  }

  if (actionType === "keypress") {
    for (const alias of KEYS_FIELD_ALIASES) {
      if (alias in action && !("keys" in action)) {
        action.keys = action[alias];
        delete action[alias];
      }
    }
    const keys = action.keys;
    if (typeof keys === "string") {
      action.keys =
        keys.length > 1 ? keys.replace(/-/g, "+").split("+") : [keys];
    }
  }

  const allowed = REQUIRED_KEYS_BY_TYPE[actionType];
  if (allowed) {
    for (const key of Object.keys(action)) {
      if (!allowed.includes(key)) delete action[key];
    }
  }

  return action;
}

export interface OperatorNormalizerOptions {
  onNormalize?: (before: RawComputerCallAction, after: RawComputerCallAction) => void;
}

export class OperatorNormalizerCallback implements AgentCallbackHandler {
  readonly name = "operator-normalizer";
  private readonly options: OperatorNormalizerOptions;

  constructor(options: OperatorNormalizerOptions = {}) {
    this.options = options;
  }

  normalize(action: RawComputerCallAction): RawComputerCallAction {
    const before = action;
    const after = normalizeComputerCallAction(action);
    this.options.onNormalize?.(before, after);
    return after;
  }
}
