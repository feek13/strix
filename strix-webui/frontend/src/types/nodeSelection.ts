import type { Scan, Agent, ToolExecution, Vulnerability } from "./index";

export type SelectedNode =
  | { type: "target"; data: Scan }
  | { type: "agent"; data: Agent }
  | { type: "tool"; data: ToolExecution }
  | { type: "finding"; data: Vulnerability };
