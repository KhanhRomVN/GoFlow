import React, { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import "../../styles/declaration-node.css";

const DECLARATION_COLORS = {
  class: {
    header: "bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500",
    accent: "#a855f7",
    badge: "Class",
  },
  struct: {
    header: "bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500",
    accent: "#06b6d4",
    badge: "Struct",
  },
  interface: {
    header: "bg-gradient-to-r from-amber-500 via-orange-500 to-red-500",
    accent: "#f59e0b",
    badge: "Interface",
  },
  enum: {
    header: "bg-gradient-to-r from-lime-500 via-green-500 to-emerald-500",
    accent: "#84cc16",
    badge: "Enum",
  },
  type: {
    header: "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500",
    accent: "#6366f1",
    badge: "Type",
  },
  unknown: {
    header: "bg-gradient-to-r from-gray-500 via-slate-500 to-neutral-500",
    accent: "#6b7280",
    badge: "Unknown",
  },
} as const;

interface DeclarationNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "class" | "struct" | "interface" | "enum" | "type" | "unknown";
  file: string;
  line: number;
  code: string;
  language?: string;
  usedBy: string[]; // Danh sách các FunctionNode IDs sử dụng declaration này
}

const DeclarationNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as DeclarationNodeData;

  const getRelativePath = (fullPath: string): string => {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-3).join("/");
  };

  const nodeColors =
    DECLARATION_COLORS[nodeData.type as keyof typeof DECLARATION_COLORS] ||
    DECLARATION_COLORS.unknown;

  const getLanguageSpecificBadge = (): string => {
    const language = nodeData.language || "unknown";
    const type = nodeData.type;

    const languageBadges: Record<string, Record<string, string>> = {
      python: { class: "class" },
      javascript: { class: "class" },
      typescript: { class: "class", interface: "interface", type: "type" },
      go: { struct: "type", interface: "type" },
      java: { class: "class", interface: "interface", enum: "enum" },
      csharp: {
        class: "class",
        interface: "interface",
        struct: "struct",
        enum: "enum",
      },
      rust: { struct: "struct", enum: "enum", type: "type" },
    };

    return languageBadges[language]?.[type] || nodeColors.badge;
  };

  return (
    <>
      <div
        className={`declaration-node-container ${selected ? "selected" : ""}`}
        data-type="declarationNode"
      >
        <Handle
          type="target"
          position={Position.Top}
          id="top"
          style={{
            background: nodeColors.accent,
            width: 10,
            height: 10,
            border: "2px solid white",
          }}
        />
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          style={{
            background: nodeColors.accent,
            width: 10,
            height: 10,
            border: "2px solid white",
          }}
        />

        <div
          className={`declaration-node-header declaration-node-header-${nodeData.type}`}
        >
          <span className="declaration-node-type-badge">
            {getLanguageSpecificBadge()}
          </span>
          <span className="declaration-node-label">{nodeData.label}</span>
          {nodeData.usedBy && nodeData.usedBy.length > 1 && (
            <span
              className="declaration-node-usage-badge"
              title={`Used by ${nodeData.usedBy.length} functions`}
            >
              ×{nodeData.usedBy.length}
            </span>
          )}
        </div>

        <div className="declaration-node-body">
          <pre className="declaration-node-code">
            <code>{nodeData.code}</code>
          </pre>
        </div>

        <div className="declaration-node-footer">
          <span className="declaration-node-file-path" title={nodeData.file}>
            📄 {getRelativePath(nodeData.file)}
          </span>
          <span className="declaration-node-line-badge">
            Line {nodeData.line}
          </span>
        </div>
      </div>
    </>
  );
};

export default memo(DeclarationNode);
