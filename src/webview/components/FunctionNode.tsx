import React, { memo, useState, useMemo, useCallback } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import MonacoCodeEditor from "./MonacoCodeEditor";
import "../styles/function-node.css";

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
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedCode, setEditedCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);
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

  const nodeColors = NODE_COLORS[nodeData.type];

  const previewCode = useMemo(() => {
    if (!nodeData.code) return "";
    const lines = nodeData.code.split("\n");
    return lines.slice(0, 10).join("\n");
  }, [nodeData.code]);

  const totalLines = nodeData.code.split("\n").length;
  const displayCode = isExpanded ? nodeData.code : previewCode;
  const editorHeight = isExpanded ? "480px" : "220px";

  const handleEditToggle = useCallback(() => {
    console.log("[FunctionNode] Toggle edit mode:", !isEditMode);
    if (!isEditMode) {
      setEditedCode(nodeData.code);
      setIsEditMode(true);
    } else {
      setIsEditMode(false);
    }
  }, [isEditMode, nodeData.code]);

  const handleCodeChange = useCallback((value: string) => {
    console.log("[FunctionNode] Code changed, length:", value.length);
    setEditedCode(value);
  }, []);

  const handleSave = useCallback(async () => {
    console.log("[FunctionNode] Save button clicked");
    console.log("[FunctionNode] File:", nodeData.file);
    console.log("[FunctionNode] Lines:", nodeData.line, "-", nodeData.endLine);
    console.log("[FunctionNode] New code length:", editedCode.length);

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
        code: editedCode,
        nodeId: nodeData.id,
      });

      console.log("[FunctionNode] Save message sent to backend");

      // Wait for confirmation (will be handled by message listener in FlowGraph)
      setTimeout(() => {
        setIsSaving(false);
        setIsEditMode(false);
        console.log("[FunctionNode] Save completed (timeout)");
      }, 1000);
    } catch (error) {
      console.error("[FunctionNode] Failed to save:", error);
      setIsSaving(false);
    }
  }, [editedCode, nodeData]);

  const handleCancel = useCallback(() => {
    console.log("[FunctionNode] Cancel edit");
    setIsEditMode(false);
    setEditedCode(nodeData.code);
  }, [nodeData.code]);

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
        onClick={() => !isEditMode && setIsExpanded(!isExpanded)}
      >
        <span className="function-node-type-badge">
          {nodeData.type === "function" ? "Function" : "Method"}
        </span>
        <span className="function-node-label">{nodeData.label}</span>
        {isEditMode && (
          <span className="function-node-edit-indicator">✏️ EDITING</span>
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
            value={isEditMode ? editedCode : displayCode}
            onChange={isEditMode ? handleCodeChange : () => {}}
            language="go"
            height={editorHeight}
            readOnly={!isEditMode}
            lineNumber={nodeData.line}
          />
        </div>
        {!isExpanded && !isEditMode && totalLines > 10 && (
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

        <div className="function-node-actions">
          {!isEditMode ? (
            <button
              onClick={handleEditToggle}
              className="function-node-action-button function-node-action-edit"
              title="Edit code"
            >
              ✏️ Edit
            </button>
          ) : (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="function-node-action-button function-node-action-save"
                title="Save changes"
              >
                {isSaving ? "💾 Saving..." : "💾 Save"}
              </button>
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="function-node-action-button function-node-action-cancel"
                title="Cancel edit"
              >
                ❌ Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(FunctionNode);
