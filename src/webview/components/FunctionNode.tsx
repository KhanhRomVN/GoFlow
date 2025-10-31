import React, { memo, useState, useMemo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

const NODE_COLORS = {
  function: "from-green-600 to-emerald-600",
  method: "from-blue-600 to-cyan-600",
} as const;

interface FunctionNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
  endLine?: number;
  code: string;
}

interface FunctionCall {
  lineIndex: number;
  functionName: string;
  absoluteLine: number;
}

const FunctionNode: React.FC<NodeProps> = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const nodeData = data as FunctionNodeData;

  const getRelativePath = (fullPath: string): string => {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-3).join("/");
  };

  const getLineRange = (): string => {
    if (nodeData.endLine) {
      return `Lines ${nodeData.line}-${nodeData.endLine}`;
    }
    return `Line ${nodeData.line}`;
  };

  // Phân tích code để tìm function calls và vị trí của chúng
  const functionCalls = useMemo((): FunctionCall[] => {
    if (!nodeData.code) return [];

    const calls: FunctionCall[] = [];
    const lines = nodeData.code.split("\n");
    const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    lines.forEach((line, index) => {
      let match;
      while ((match = functionCallRegex.exec(line)) !== null) {
        const functionName = match[1];
        // Bỏ qua keywords và built-in functions
        const skipKeywords = [
          "if",
          "for",
          "while",
          "switch",
          "return",
          "func",
          "make",
          "len",
          "append",
          "print",
          "println",
        ];
        if (!skipKeywords.includes(functionName)) {
          calls.push({
            lineIndex: index,
            functionName,
            absoluteLine: nodeData.line + index,
          });
        }
      }
    });

    return calls;
  }, [nodeData.code, nodeData.line]);

  // Tính toán vị trí Y cho mỗi handle dựa trên line number
  const calculateHandlePosition = (lineIndex: number): number => {
    const totalLines = nodeData.code.split("\n").length;
    const visibleLines = isExpanded ? totalLines : Math.min(10, totalLines);
    const headerHeight = 56; // px
    const footerHeight = 48; // px
    const lineHeight = 19.2; // px (font-size 12px * line-height 1.6)
    const bodyPadding = 24; // 12px top + 12px bottom

    const bodyHeight = visibleLines * lineHeight + bodyPadding;
    const relativePosition = lineIndex / totalLines;

    return headerHeight + relativePosition * bodyHeight;
  };

  const nodeColor = NODE_COLORS[nodeData.type];

  // Lấy preview code (10 dòng đầu)
  const previewCode = useMemo(() => {
    if (!nodeData.code) return "";
    const lines = nodeData.code.split("\n");
    return lines.slice(0, 10).join("\n");
  }, [nodeData.code]);

  const totalLines = nodeData.code.split("\n").length;
  const displayCode = isExpanded ? nodeData.code : previewCode;

  return (
    <div className="function-node">
      {/* Handle Input - Top Center */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={{
          background: "#6366f1",
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />

      {/* Header - Single Row */}
      <div
        className={`function-node-header bg-gradient-to-r ${nodeColor}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="function-node-badge">
          {nodeData.type === "function" ? "Function" : "Method"}
        </span>
        <span className="function-node-title">{nodeData.label}</span>
        <button
          className="function-node-expand-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded ? "−" : "+"}
        </button>
      </div>

      {/* Body - Code Preview */}
      <div
        className={`function-node-body ${
          isExpanded ? "expanded" : "collapsed"
        }`}
      >
        <pre className="function-node-code">
          <code className="language-go">{displayCode}</code>
        </pre>
        {!isExpanded && totalLines > 10 && (
          <div className="function-node-more">
            <span>+{totalLines - 10} more lines</span>
          </div>
        )}
      </div>

      {/* Footer - Path and Line Info */}
      <div className="function-node-footer">
        <span className="function-node-path" title={nodeData.file}>
          📄 {getRelativePath(nodeData.file)}
        </span>
        <span className="function-node-line-range">{getLineRange()}</span>
      </div>

      {/* Multiple Handles - Right Side (for each function call) */}
      {functionCalls.map((call, index) => (
        <Handle
          key={`call-${index}-${call.lineIndex}`}
          type="source"
          position={Position.Right}
          id={`call-${index}`}
          style={{
            top: `${calculateHandlePosition(call.lineIndex)}px`,
            background: "#8b5cf6",
            width: 10,
            height: 10,
            border: "2px solid white",
            right: -5,
          }}
          title={`${call.functionName} at line ${call.absoluteLine}`}
        />
      ))}

      {/* Default Bottom Handle (fallback nếu không có function calls) */}
      {functionCalls.length === 0 && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          style={{
            background: "#8b5cf6",
            width: 12,
            height: 12,
            border: "2px solid white",
          }}
        />
      )}
    </div>
  );
};

export default memo(FunctionNode);
