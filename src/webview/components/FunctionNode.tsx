import React, {
  memo,
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import MonacoCodeEditor from "./MonacoCodeEditor";
import "../styles/function-node.css";
import { Logger } from "../../utils/webviewLogger";

const NODE_COLORS = {
  function: {
    header: "bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500",
    accent: "#10b981",
  },
  method: {
    header: "bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500",
    accent: "#6366f1",
  },
} as const;

interface FunctionNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
  endLine?: number;
  code: string;
  vscode?: any;
}

const FunctionNode: React.FC<NodeProps> = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const nodeData = data as FunctionNodeData;
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const nodeColors = NODE_COLORS[nodeData.type];

  const previewCode = useMemo(() => {
    if (!nodeData.code) return "";
    const lines = nodeData.code.split("\n");
    return lines.slice(0, 10).join("\n");
  }, [nodeData.code]);

  const totalLines = nodeData.code.split("\n").length;
  const displayCode = isExpanded ? nodeData.code : previewCode;
  const editorHeight = isExpanded ? "480px" : "220px";

  const handleCodeChange = useCallback(
    (value: string) => {
      Logger.info("[FunctionNode] Code changed, length:", value.length);

      // Clear previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce auto-save after 1.5 seconds
      saveTimeoutRef.current = setTimeout(async () => {
        Logger.info("[FunctionNode] Auto-saving code...");
        Logger.info(`[FunctionNode] File: ${nodeData.file}`);
        Logger.info(
          `[FunctionNode] Lines: ${nodeData.line}-${nodeData.endLine}`
        );

        if (!nodeData.vscode) {
          console.error("[FunctionNode] VSCode API not available");
          return;
        }

        setIsSaving(true);

        try {
          nodeData.vscode.postMessage({
            command: "saveCode",
            file: nodeData.file,
            startLine: nodeData.line,
            endLine: nodeData.endLine || nodeData.line,
            code: value,
            nodeId: nodeData.id,
          });

          Logger.info("[FunctionNode] Auto-save message sent to backend");

          // Reset saving indicator after 1 second
          setTimeout(() => {
            setIsSaving(false);
            Logger.info("[FunctionNode] Auto-save completed");
          }, 1000);
        } catch (error) {
          console.error("[FunctionNode] Failed to auto-save:", error);
          setIsSaving(false);
        }
      }, 1500);
    },
    [nodeData]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="function-node-container">
      {/* Center Handles Only */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={{
          background: nodeColors.accent,
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{
          background: nodeColors.accent,
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{
          background: "#8b5cf6",
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
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

      <div
        className={`function-node-header ${
          nodeData.type === "function"
            ? "function-node-header-function"
            : "function-node-header-method"
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="function-node-type-badge">
          {nodeData.type === "function" ? "Function" : "Method"}
        </span>
        <span className="function-node-label">{nodeData.label}</span>
        {isSaving && (
          <span className="function-node-saving-indicator">💾 Saving...</span>
        )}
      </div>

      <div
        className={`function-node-body ${
          isExpanded
            ? "function-node-body-expanded"
            : "function-node-body-collapsed"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="function-node-monaco-wrapper">
          <MonacoCodeEditor
            value={displayCode}
            onChange={handleCodeChange}
            language="go"
            height={editorHeight}
            readOnly={false}
            lineNumber={nodeData.line}
          />
        </div>
        {!isExpanded && totalLines > 10 && (
          <div className="function-node-more-lines">
            ... {totalLines - 10} more lines (click header to expand)
          </div>
        )}
      </div>

      <div className="function-node-footer">
        <span className="function-node-file-path" title={nodeData.file}>
          📄 {getRelativePath(nodeData.file)}
        </span>
        <span className="function-node-line-badge">{getLineRange()}</span>
      </div>
    </div>
  );
};

export default memo(FunctionNode);
