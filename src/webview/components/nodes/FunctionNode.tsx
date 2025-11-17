import React, {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { Handle, Position, NodeProps, NodeResizer } from "@xyflow/react";
import MonacoCodeEditor from "../editors/MonacoCodeEditor";
import "../../styles/function-node.css";
import { Logger } from "../../../utils/webviewLogger";

// DEBUG instrumentation counters (module scope so they persist across renders)
let fnRenderCount = 0;
let fnMountCount = 0;
let fnHeightChangeCount = 0;
let fnLineClickCount = 0;
let fnNodeClickToggleCount = 0;
let fnSaveScheduleCount = 0;
let fnSaveExecCount = 0;

const NODE_COLORS = {
  function: {
    header: "bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500",
    accent: "#10b981",
    badge: "Function",
  },
  method: {
    header: "bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500",
    accent: "#6366f1",
    badge: "Method",
  },
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
  constructor: {
    header: "bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500",
    accent: "#8b5cf6",
    badge: "Constructor",
  },
  property: {
    header: "bg-gradient-to-r from-lime-500 via-green-500 to-emerald-500",
    accent: "#84cc16",
    badge: "Property",
  },
  variable: {
    header: "bg-gradient-to-r from-slate-500 via-gray-500 to-zinc-500",
    accent: "#64748b",
    badge: "Variable",
  },
  unknown: {
    header: "bg-gradient-to-r from-gray-500 via-slate-500 to-neutral-500",
    accent: "#6b7280",
    badge: "Unknown",
  },
} as const;

// Language-specific badge mapping
const LANGUAGE_BADGES: Record<string, Record<string, string>> = {
  python: {
    function: "def",
    method: "def",
    class: "class",
  },
  javascript: {
    function: "function",
    method: "method",
    class: "class",
  },
  typescript: {
    function: "function",
    method: "method",
    class: "class",
    interface: "interface",
  },
  go: {
    function: "func",
    method: "func",
    struct: "type",
    interface: "type",
  },
  java: {
    function: "method",
    method: "method",
    class: "class",
    interface: "interface",
    constructor: "constructor",
  },
  csharp: {
    function: "method",
    method: "method",
    class: "class",
    interface: "interface",
    struct: "struct",
    property: "property",
  },
  rust: {
    function: "fn",
    method: "fn",
    struct: "struct",
    interface: "trait",
  },
  php: {
    function: "function",
    method: "method",
    class: "class",
    interface: "interface",
  },
};

interface FunctionNodeData extends Record<string, unknown> {
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
  onEditorHeightChange?: (height: number) => void;
  // NEW: starting line number (relative inside this function code) after which lines are faded (execution simulation)
  fadeFromLine?: number;
}

const FunctionNode: React.FC<NodeProps> = ({ data, selected, id }) => {
  const nodeData = data as FunctionNodeData;

  // Render counter
  try {
    fnRenderCount++;
    Logger.debug(`[FunctionNode] RENDER #${fnRenderCount}`, {
      nodeId: id,
      type: nodeData.type,
      label: nodeData.label,
      isSelected: selected,
      codeLength: nodeData.code?.length,
    });
  } catch {}

  const [isSaving, setIsSaving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isNodeHighlighted, setIsNodeHighlighted] = useState(false);
  const [editorHeight, setEditorHeight] = useState(150);
  const [totalNodeHeight, setTotalNodeHeight] = useState(206); // Initial: 56 (header) + 150 (editor) + 8 (padding)
  const [editorWidth, setEditorWidth] = useState<number | null>(null);
  const [editorBaseWidth, setEditorBaseWidth] = useState<number | null>(null);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  const lineHighlightedEdges = nodeData.lineHighlightedEdges || new Set();

  // Đồng bộ trạng thái move-mode với ReactFlow (bật/tắt draggable của node)
  useEffect(() => {
    try {
      window.postMessage(
        {
          command: "setNodeDraggable",
          nodeId: nodeData.id,
          draggable: true,
        },
        "*"
      );
    } catch (e) {
      console.error("[FunctionNode] Failed to post setNodeDraggable", e);
    }
  }, [true, nodeData.id]);

  // Handle editor height changes
  const handleEditorHeightChange = useCallback(
    (height: number) => {
      setEditorHeight(height);
      fnHeightChangeCount++;

      // Calculate new total node height
      const newTotalHeight = 56 + height + 8; // header (56) + editor + padding (8)
      setTotalNodeHeight(newTotalHeight);

      // CRITICAL: Force update React Flow node dimensions
      if (nodeRef.current) {
        nodeRef.current.style.height = `${newTotalHeight}px`;

        // Trigger React Flow to recalculate node dimensions
        const resizeEvent = new Event("resize");
        window.dispatchEvent(resizeEvent);
      }

      // Update node data if callback exists
      if (nodeData.onEditorHeightChange) {
        nodeData.onEditorHeightChange(newTotalHeight);
      }

      // CRITICAL: Update React Flow node height
      // This triggers React Flow to recalculate node dimensions
      if (nodeRef.current) {
        nodeRef.current.style.height = `${newTotalHeight}px`;
      }
    },
    [nodeData]
  );

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

      fnSaveScheduleCount++;

      saveTimeoutRef.current = setTimeout(async () => {
        if (!nodeData.vscode) {
          console.error("[FunctionNode] VSCode API not available");
          return;
        }

        setIsSaving(true);

        try {
          fnSaveExecCount++;

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
          console.error("[FunctionNode] Failed to auto-save:", error);
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
      fnLineClickCount++;

      const globalReady = !!(window as any).__goflowGraphReady;
      const edgeArray = (window as any).__goflowEdges;
      const edgeCount = Array.isArray(edgeArray) ? edgeArray.length : 0;
      const globalNodes = (window as any).__goflowNodes || [];
      const nodesReady = globalNodes.length > 0;

      const thisNodeExists = globalNodes.some((n: any) => n.id === nodeData.id);
      const effectiveReady =
        globalReady && edgeCount > 0 && nodesReady && thisNodeExists;

      Logger.debug(`[FunctionNode] Line click handled`, {
        nodeId: nodeData.id,
        lineNumber,
        lineContent: lineContent.substring(0, 50),
        globalReady,
        edgeCount,
        nodesReady: globalNodes.length,
        thisNodeExists,
        effectiveReady,
        lineClickCount: fnLineClickCount,
        sessionId: (window as any).__goflowSessionId,
      });

      if (!effectiveReady) {
        Logger.warn(`[FunctionNode] Graph not ready - QUEUING actions`, {
          nodeId: nodeData.id,
          effectiveReady,
          missingComponents: {
            globalReady: !globalReady,
            edges: edgeCount === 0,
            nodes: !nodesReady,
            thisNode: !thisNodeExists,
          },
        });

        (window as any).__goflowPendingLineClick = {
          nodeId: nodeData.id,
          file: nodeData.file,
          functionStartLine: nodeData.line,
          lineNumber,
          lineContent,
          timestamp: Date.now(),
        };
        (window as any).__goflowPendingNodeHighlight = nodeData.id;
        return;
      }

      // Step 1: Resolve definition
      if (nodeData.vscode) {
        nodeData.vscode.postMessage({
          command: "resolveDefinitionAtLine",
          file: nodeData.file,
          line: nodeData.line,
          relativeLine: lineNumber,
          lineContent: lineContent,
          nodeId: nodeData.id,
          shouldTracePath: false,
        });
      }

      // Step 2: Highlight parent nodes
      if (typeof nodeData.onNodeHighlight === "function") {
        nodeData.onNodeHighlight(nodeData.id);
        setIsNodeHighlighted(true);
      }
    },
    [nodeData] // Không cần nodes.length vì dùng window global
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
          fnNodeClickToggleCount++;
        } else {
          nodeData.onNodeHighlight(nodeData.id);
          setIsNodeHighlighted(true);
          fnNodeClickToggleCount++;
        }
      }
    },
    [nodeData, isNodeHighlighted]
  );

  const handleEditorWidthChange = useCallback(
    (width: number, baseWidth: number) => {
      setEditorWidth(width);
      if (editorBaseWidth === null) {
        setEditorBaseWidth(baseWidth);
      }
    },
    [editorBaseWidth]
  );

  // Compute node width:
  // - Use measured editor content width (editorWidth) provided by MonacoCodeEditor
  // - Add header horizontal padding (16 + 16) and border (2 + 2)
  // - Never exceed the initially captured base width (editorBaseWidth)
  // - Maintain a sane minimum width for readability
  const autoNodeWidth = useMemo(() => {
    if (!editorWidth) return undefined;

    // editorWidth already includes gutter + padding from Monaco wrapper.
    // Use it directly to avoid double-padding causing mismatch.
    const min = 250;
    return Math.max(min, editorWidth);
  }, [editorWidth]);

  return (
    <>
      <NodeResizer
        color={nodeData.type === "function" ? "#10b981" : "#6366f1"}
        isVisible={selected}
        minWidth={
          250
        } /* Reduced to allow shrink-to-fit with Monaco measured width */
        minHeight={totalNodeHeight}
        maxWidth={1400}
        maxHeight={800}
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
        } ${true ? "move-mode" : ""}`}
        data-type="functionNode"
        style={autoNodeWidth ? { width: `${autoNodeWidth}px` } : undefined}
        onClick={handleNodeClick}
        onMouseDown={(e) => {
          // Ở chế độ đứng yên: chặn drag ReactFlow (cho phép chọn text trong editor)
          if (!true) e.stopPropagation();
        }}
        onPointerDown={(e) => {
          if (!true) e.stopPropagation();
        }}
      >
        {/* Smart Handles - chỉ hiển thị handles có khả năng được sử dụng */}
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
          isConnectable={true}
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
            opacity: 0.3, // Mờ đi để chỉ ra ít được sử dụng
          }}
          isConnectable={true}
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
          isConnectable={true}
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
            opacity: 0.3, // Mờ đi để chỉ ra ít được sử dụng
          }}
          isConnectable={true}
        />

        <div
          className={`code-entity-node-header ${
            nodeData.type === "function"
              ? "code-entity-node-header-function"
              : "code-entity-node-header-method"
          }`}
        >
          <span className="code-entity-node-type-badge">
            {(() => {
              const language = (nodeData as any).language || "unknown";
              const type = nodeData.type;

              // Ưu tiên badge theo ngôn ngữ
              if (
                LANGUAGE_BADGES[language] &&
                LANGUAGE_BADGES[language][type]
              ) {
                return LANGUAGE_BADGES[language][type];
              }

              // Fallback về badge mặc định
              return (
                NODE_COLORS[type as keyof typeof NODE_COLORS]?.badge || type
              );
            })()}
          </span>
          <span className="code-entity-node-label">{nodeData.label}</span>
          {(nodeData as any).isNested && (
            <span
              className="code-entity-node-nested-indicator"
              title="Nested function"
            >
              🔗
            </span>
          )}
          {(nodeData as any).returnType &&
            (nodeData as any).returnType !== "unknown" && (
              <span
                className="code-entity-node-return-type"
                title={`Returns: ${(nodeData as any).returnType}`}
              >
                → {(nodeData as any).returnType}
              </span>
            )}
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
          {(window as any).__goflowPendingLineClick?.nodeId === nodeData.id && (
            <span
              className="code-entity-node-queued-indicator"
              title="Action queued - graph loading"
            >
              ⏳ Queued
            </span>
          )}
        </div>

        <div
          className="code-entity-node-body"
          style={{
            minHeight: `${editorHeight}px`,
            height: `${editorHeight}px`,
            maxHeight: "500px",
            overflow: "hidden",
          }}
        >
          <div
            className="code-entity-node-monaco-wrapper nodrag"
            style={{ height: "100%" }}
            onMouseDown={(e) => {
              if (!true) e.stopPropagation();
            }}
            onPointerDown={(e) => {
              if (!true) e.stopPropagation();
            }}
          >
            <MonacoCodeEditor
              value={displayCode}
              onChange={handleCodeChange}
              language="go"
              height="100%"
              readOnly={true}
              lineNumber={nodeData.line}
              onLineClick={handleLineClick}
              onEditorHeightChange={handleEditorHeightChange}
              onEditorWidthChange={handleEditorWidthChange}
              nodeId={nodeData.id}
              allEdges={(window as any).__goflowEdges || []}
              fadeFromLine={nodeData.fadeFromLine}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(FunctionNode);
