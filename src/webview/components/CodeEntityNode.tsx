import React, { memo, useState, useCallback, useRef, useEffect } from "react";
import { Handle, Position, NodeProps, NodeResizer } from "@xyflow/react";
import MonacoCodeEditor from "./MonacoCodeEditor";
import "../styles/code-entity-node.css";
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

interface CodeEntityNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
  endLine?: number;
  code: string;
  vscode?: any;
  onHighlightEdge?: (sourceNodeId: string, targetNodeId: string) => void;
  onClearHighlight?: () => void;
  onNodeHighlight?: (nodeId: string) => void;
  onClearNodeHighlight?: () => void;
  allNodes?: any[];
  lineHighlightedEdges?: Set<string>;
}

const CodeEntityNode: React.FC<NodeProps> = ({ data, selected }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isNodeHighlighted, setIsNodeHighlighted] = useState(false);
  const nodeData = data as CodeEntityNodeData;
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const lineHighlightedEdges = nodeData.lineHighlightedEdges || new Set();

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

  const displayCode = nodeData.code;

  const handleCodeChange = useCallback(
    (value: string) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        if (!nodeData.vscode) {
          console.error("[CodeEntityNode] VSCode API not available");
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

          setTimeout(() => {
            setIsSaving(false);
          }, 1000);
        } catch (error) {
          console.error("[CodeEntityNode] Failed to auto-save:", error);
          setIsSaving(false);
        }
      }, 1500);
    },
    [nodeData]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleLineClick = useCallback(
    (lineNumber: number, lineContent: string) => {
      // Step 1: Resolve definition at clicked line (yellow line)
      if (nodeData.vscode && nodeData.onHighlightEdge) {
        nodeData.vscode.postMessage({
          command: "resolveDefinitionAtLine",
          file: nodeData.file,
          line: nodeData.line,
          relativeLine: lineNumber,
          lineContent: lineContent,
          nodeId: nodeData.id,
          shouldTracePath: false, // Không trace path ở đây
        });
      }

      // Step 2: Highlight parent nodes (red lines)
      if (typeof nodeData.onNodeHighlight === "function") {
        nodeData.onNodeHighlight(nodeData.id);
        setIsNodeHighlighted(true);
      } else {
        Logger.warn(
          `[CodeEntityNode] onNodeHighlight is not a function for: ${nodeData.id}`
        );
      }
    },
    [nodeData]
  );

  const handleNodeClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".monaco-editor")) {
        return;
      }

      if (
        typeof nodeData.onNodeHighlight === "function" &&
        typeof nodeData.onClearNodeHighlight === "function"
      ) {
        if (isNodeHighlighted) {
          nodeData.onClearNodeHighlight();
          setIsNodeHighlighted(false);
        } else {
          nodeData.onNodeHighlight(nodeData.id);
          setIsNodeHighlighted(true);
        }
      }
    },
    [nodeData, isNodeHighlighted]
  );

  return (
    <>
      <NodeResizer
        color={nodeData.type === "function" ? "#10b981" : "#6366f1"}
        isVisible={selected}
        minWidth={650}
        minHeight={300}
        maxWidth={1400}
        maxHeight={1200}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: nodeData.type === "function" ? "#10b981" : "#6366f1",
          border: "2px solid white",
        }}
        lineStyle={{
          borderWidth: 2,
          borderColor: nodeData.type === "function" ? "#10b981" : "#6366f1",
        }}
        onResizeStart={() => setIsResizing(true)}
        onResizeEnd={() => setIsResizing(false)}
      />

      <div
        className={`code-entity-node-container ${
          isResizing ? "resizing" : ""
        } ${isNodeHighlighted ? "node-highlighted" : ""} ${
          lineHighlightedEdges.size > 0 ? "line-highlighted" : ""
        }`}
        data-type="codeEntityNode"
        onClick={handleNodeClick}
      >
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
          className={`code-entity-node-header ${
            nodeData.type === "function"
              ? "code-entity-node-header-function"
              : "code-entity-node-header-method"
          }`}
        >
          <span className="code-entity-node-type-badge">
            {nodeData.type === "function" ? "Function" : "Method"}
          </span>
          <span className="code-entity-node-label">{nodeData.label}</span>
          {isNodeHighlighted && (
            <span className="code-entity-node-parent-indicator">
              ⬆️ Parents
            </span>
          )}
          {lineHighlightedEdges.size > 0 && (
            <span className="code-entity-node-line-indicator">
              🔗 Line Link
            </span>
          )}
          {isSaving && (
            <span className="code-entity-node-saving-indicator">
              💾 Saving...
            </span>
          )}
        </div>

        <div
          className="code-entity-node-body"
          style={{
            flex: 1,
            minHeight: 200,
            overflow: "hidden",
          }}
        >
          <div
            className="code-entity-node-monaco-wrapper"
            style={{ height: "100%" }}
          >
            <MonacoCodeEditor
              value={displayCode}
              onChange={handleCodeChange}
              language="go"
              height="100%"
              readOnly={false}
              lineNumber={nodeData.line}
              onLineClick={handleLineClick}
            />
          </div>
        </div>

        <div className="code-entity-node-footer">
          <span className="code-entity-node-file-path" title={nodeData.file}>
            📄 {getRelativePath(nodeData.file)}
          </span>
          <span className="code-entity-node-line-badge">{getLineRange()}</span>
        </div>
      </div>
    </>
  );
};

export default memo(CodeEntityNode);
