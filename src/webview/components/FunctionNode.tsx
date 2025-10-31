import React, { memo, useState, useMemo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

const NODE_COLORS = {
  function: "bg-gradient-to-r from-green-600 to-emerald-600",
  method: "bg-gradient-to-r from-blue-600 to-cyan-600",
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

  const functionCalls = useMemo((): FunctionCall[] => {
    if (!nodeData.code) return [];

    const calls: FunctionCall[] = [];
    const lines = nodeData.code.split("\n");
    const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    lines.forEach((line, index) => {
      let match;
      while ((match = functionCallRegex.exec(line)) !== null) {
        const functionName = match[1];
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

  const calculateHandlePosition = (lineIndex: number): number => {
    const totalLines = nodeData.code.split("\n").length;
    const visibleLines = isExpanded ? totalLines : Math.min(10, totalLines);
    const headerHeight = 56;
    const footerHeight = 48;
    const lineHeight = 19.2;
    const bodyPadding = 24;

    const bodyHeight = visibleLines * lineHeight + bodyPadding;
    const relativePosition = lineIndex / totalLines;

    return headerHeight + relativePosition * bodyHeight;
  };

  const nodeColor = NODE_COLORS[nodeData.type];

  const previewCode = useMemo(() => {
    if (!nodeData.code) return "";
    const lines = nodeData.code.split("\n");
    return lines.slice(0, 10).join("\n");
  }, [nodeData.code]);

  const totalLines = nodeData.code.split("\n").length;
  const displayCode = isExpanded ? nodeData.code : previewCode;

  return (
    <div className="bg-[var(--vscode-editor-background)] border-2 border-[var(--vscode-panel-border)] rounded-lg w-80 shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5">
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

      <div
        className={`flex items-center gap-2 px-4 py-3 text-white border-b-2 border-black/20 cursor-pointer select-none min-h-[56px] ${nodeColor} hover:brightness-110`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-black/25 rounded flex-shrink-0">
          {nodeData.type === "function" ? "Function" : "Method"}
        </span>
        <span className="font-semibold text-sm whitespace-nowrap overflow-hidden text-ellipsis flex-1 font-mono">
          {nodeData.label}
        </span>
        <button
          className="bg-black/20 border-none text-white w-7 h-7 flex items-center justify-center cursor-pointer text-base font-bold rounded transition-all flex-shrink-0 hover:bg-black/35 hover:scale-110"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded ? "−" : "+"}
        </button>
      </div>

      <div
        className={`bg-[var(--vscode-editor-background)] overflow-hidden transition-all duration-300 ${
          isExpanded ? "max-h-[600px] overflow-y-auto" : "max-h-60"
        }`}
      >
        <pre className="m-0 p-3 font-mono text-xs leading-relaxed text-[var(--vscode-editor-foreground)] bg-[var(--vscode-editor-background)] overflow-x-auto">
          <code className="language-go whitespace-pre">{displayCode}</code>
        </pre>
        {!isExpanded && totalLines > 10 && (
          <div className="text-center py-2 bg-[var(--vscode-editor-background)] border-t border-[var(--vscode-panel-border)] text-[11px] text-[var(--vscode-descriptionForeground)] italic">
            <span>+{totalLines - 10} more lines</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[var(--vscode-editorWidget-background)] border-t border-[var(--vscode-panel-border)] min-h-[48px]">
        <span
          className="text-[11px] text-[var(--vscode-descriptionForeground)] whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0"
          title={nodeData.file}
        >
          📄 {getRelativePath(nodeData.file)}
        </span>
        <span className="font-mono text-[10px] font-semibold bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] px-2 py-1 rounded flex-shrink-0">
          {getLineRange()}
        </span>
      </div>

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
