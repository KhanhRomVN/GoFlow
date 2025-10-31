import React, { memo, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import {
  FunctionNodeData,
  NODE_COLORS,
  PREVIEW_LINES,
} from "../../models/FlowNode";

const FunctionNode: React.FC<NodeProps> = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getPreviewCode = (code: string, lines: number): string => {
    const codeLines = code.split("\n");
    if (codeLines.length <= lines) {
      return code;
    }
    return codeLines.slice(0, lines).join("\n");
  };

  const nodeData = data as FunctionNodeData;

  // Kiểm tra xem có phải là cross-file node không
  const isCrossFile =
    nodeData.file &&
    !nodeData.file.includes(window.location.pathname.split("/").pop() || "");

  const displayCode = isExpanded
    ? nodeData.code
    : getPreviewCode(nodeData.code, PREVIEW_LINES);
  const hasMoreLines = nodeData.code.split("\n").length > PREVIEW_LINES;
  const nodeColor = NODE_COLORS[nodeData.type];

  return (
    <div className="function-node">
      <Handle type="target" position={Position.Top} />

      {/* Header */}
      <div
        className="function-node-header"
        style={{ backgroundColor: nodeColor }}
      >
        <div className="function-node-icon">
          {nodeData.type === "function" ? "𝑓" : "ⓜ"}
        </div>
        <div className="function-node-title">{nodeData.label}</div>
        <div className="function-node-meta">
          <span title={nodeData.file} className="file-indicator">
            📄 {nodeData.file.split("/").pop()?.replace(".go", "")}
          </span>
          <span className="line-indicator">Line {nodeData.line}</span>
        </div>
      </div>

      {/* Body */}
      <div className={`function-node-body ${isExpanded ? "expanded" : ""}`}>
        <pre className="function-node-code">
          <code>{displayCode}</code>
        </pre>
      </div>

      {/* Footer */}
      {hasMoreLines && (
        <div className="function-node-footer">
          <button
            className="function-node-toggle"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? "↑ Show less" : "↓ Show more"}
          </button>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export default memo(FunctionNode);
