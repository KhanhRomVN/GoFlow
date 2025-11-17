import React, { memo, useState, useEffect, useRef } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import "../../styles/declaration-node.css";
import useDebounce from "../../hooks/useDebounce";

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

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [baseWidth, setBaseWidth] = useState<number | null>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const debouncedCode = useDebounce(nodeData.code, 150);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const getRelativePath = (fullPath: string): string => {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-3).join("/");
  };

  const nodeColors =
    DECLARATION_COLORS[nodeData.type as keyof typeof DECLARATION_COLORS] ||
    DECLARATION_COLORS.unknown;

  // Capture initial (default) width once
  useEffect(() => {
    if (wrapperRef.current && baseWidth === null) {
      const w = wrapperRef.current.getBoundingClientRect().width;
      setBaseWidth(Math.ceil(w));
    }
  }, [baseWidth]);

  // Fit-width logic (grow & shrink independently of initial base width)
  useEffect(() => {
    if (baseWidth === null) return;
    try {
      const lines = (debouncedCode || "").split(/\r?\n/);
      let longest = "";
      for (const l of lines) if (l.length > longest.length) longest = l;

      // Measure longest line monospace width
      let measured = longest.length * 7; // fallback heuristic
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = `11px 'Courier New', monospace`;
        measured = ctx.measureText(longest || " ").width;
      }

      const gutter = 0; // no Monaco here, keep minimal extra
      const padding = 32; // header + body horizontal padding + borders
      const target = Math.ceil(measured + gutter + padding);

      const min = 220;
      const max = 1200;
      const final = Math.max(min, Math.min(target, max));

      setFitWidth(final);
    } catch (e) {
      // swallow measurement errors
    }
  }, [debouncedCode, baseWidth]);

  // Dynamic height (fit content up to max lines)
  useEffect(() => {
    const lines = (debouncedCode || "").split(/\r?\n/);
    const lineHeight = 16; // ~1.5 * 11px font
    const maxLines = 18;
    const effectiveLines = Math.min(lines.length, maxLines);
    const h = effectiveLines * lineHeight + 12 + 12; // top/bottom padding from CSS (12px each)
    setContentHeight(h);
  }, [debouncedCode]);

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
        ref={wrapperRef}
        className={`declaration-node-container ${selected ? "selected" : ""}`}
        data-type="declarationNode"
        style={fitWidth ? { width: `${fitWidth}px` } : undefined}
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

        <div
          className="declaration-node-body"
          style={
            contentHeight
              ? {
                  height: `${contentHeight}px`,
                  maxHeight: `${contentHeight}px`,
                  overflowY: "hidden",
                }
              : undefined
          }
        >
          <pre
            className="declaration-node-code"
            onMouseDown={(e) => {
              // Ngăn kéo node khi đang bôi đen / select code
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              // Hỗ trợ pointer events (touch, pen)
              e.stopPropagation();
            }}
          >
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
