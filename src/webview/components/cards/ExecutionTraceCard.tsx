import React, { useMemo, useState, useCallback } from "react";
import { ExecutionTraceEntry } from "../drawers/ExecutionTraceDrawer";
import MonacoCodeEditor from "../editors/MonacoCodeEditor";

/**
 * ExecutionTraceCard
 * Dedicated card component to render a single execution trace entry.
 * Handles:
 *  - Code gutter with ABSOLUTE file line numbers (if start line known)
 *  - Relative call line highlighting inside source function for 'call' entries
 *  - Fading future lines after call line
 *  - Basic badge styling
 * Provides internal diagnostics for mismatches (console.debug)
 */
interface ExecutionTraceCardProps {
  entry: ExecutionTraceEntry;
  onJumpToNode: (nodeId: string) => void;
}

const ExecutionTraceCard: React.FC<ExecutionTraceCardProps> = ({
  entry,
  onJumpToNode,
}) => {
  // Decide which code snapshot to show per entry type
  // CALL: show caller sourceCode
  // RETURN: show callee targetCode
  // UNRESOLVED / RAW: show sourceCode
  const { codeToRender, baseStartLine, callLineRelative } = useMemo(() => {
    let code: string | undefined;
    let startLine: number | undefined;
    let relCall: number | undefined;

    if (entry.type === "call") {
      // SHOW CALLEE giống FunctionNode: hiển thị code hàm được gọi
      code = entry.targetCode || entry.sourceCode;
      startLine = entry.targetStartLine || entry.sourceStartLine;
      // relCall giữ nguyên (line gọi trong caller) chỉ để hiển thị meta, không dùng highlight callee
      relCall = undefined; // không highlight dòng gọi trong callee
    } else if (entry.type === "return") {
      // Return: vẫn hiển thị callee (target) vì giống node code viewer
      code = entry.targetCode || entry.sourceCode;
      startLine = entry.targetStartLine || entry.sourceStartLine;
    } else {
      // unresolved/raw: giữ nguyên source
      code = entry.sourceCode;
      startLine = entry.sourceStartLine;
      relCall = entry.sourceCallLine;
    }
    return {
      codeToRender: code,
      baseStartLine: startLine,
      callLineRelative: relCall,
    };
  }, [entry]);

  // Diagnostic: mismatches
  useMemo(() => {
    if (entry.type === "call" && callLineRelative && baseStartLine) {
      const absolute = baseStartLine + callLineRelative - 1;
      // If codeToRender length shorter than relative call line
      const lineCount = (codeToRender || "").split("\n").length;
      if (callLineRelative > lineCount) {
        console.debug(
          "[ExecutionTraceCard][Mismatch] Relative call line exceeds code length",
          {
            sourceNodeId: entry.sourceNodeId,
            targetNodeId: entry.targetNodeId,
            callLineRelative,
            lineCount,
            baseStartLine,
            absoluteCallLine: absolute,
          }
        );
      }
    }
  }, [entry, callLineRelative, baseStartLine, codeToRender]);

  // Height auto-sized giống FunctionNode bằng cách đếm dòng (đơn giản)
  const [editorHeight, setEditorHeight] = useState(120);
  useMemo(() => {
    if (codeToRender) {
      const lineCount = codeToRender.split("\n").length;
      const clamped = Math.min(Math.max(lineCount, 3), 25);
      setEditorHeight(clamped * 19 + 16);
    }
  }, [codeToRender]);

  const handleEditorHeightChange = useCallback((h: number) => {
    setEditorHeight(h);
  }, []);

  const getBadge = () => {
    switch (entry.type) {
      case "call":
        return { label: "CALL", className: "badge-call" };
      case "return":
        return { label: "RETURN", className: "badge-return" };
      case "unresolved":
        return { label: "UNRESOLVED", className: "badge-unresolved" };
      case "raw":
        return { label: "RAW", className: "badge-raw" };
      default:
        return { label: "STEP", className: "badge-default" };
    }
  };
  const badge = getBadge();

  const lineInfoParts: string[] = [];
  if (entry.sourceCallLine) {
    lineInfoParts.push(`Rel ${entry.sourceCallLine}`);
    if (entry.sourceStartLine) {
      lineInfoParts.push(
        `Abs ${entry.sourceStartLine + entry.sourceCallLine - 1}`
      );
    }
  }
  if (entry.sourceLineContent) {
    lineInfoParts.push(entry.sourceLineContent.trim());
  }

  return (
    <div
      className="execution-trace-card"
      onClick={() => onJumpToNode(entry.targetNodeId)}
      title={`Focus ${entry.targetNodeId}`}
    >
      <div className="execution-trace-card-header">
        <div className={`execution-trace-step-badge ${badge.className}`}>
          {entry.step}
        </div>
        <div className="execution-trace-meta">
          <div className="execution-trace-path">
            <span className="execution-trace-node-id">
              {entry.sourceNodeId}
            </span>
            <span className="execution-trace-arrow">→</span>
            <span className="execution-trace-node-id">
              {entry.targetNodeId}
            </span>
            <span className={`execution-trace-type ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <div className="execution-trace-line-info">
            {lineInfoParts.join(" • ")}
          </div>
        </div>
        <div className="execution-trace-time">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </div>
      </div>
      <div
        className="execution-trace-card-body"
        style={{ height: editorHeight, minHeight: editorHeight }}
      >
        {codeToRender && (
          <MonacoCodeEditor
            value={codeToRender}
            onChange={() => {}}
            language="go"
            height={`${editorHeight}px`}
            readOnly={true}
            lineNumber={baseStartLine || 1}
            onEditorHeightChange={handleEditorHeightChange}
            nodeId={`trace-${entry.sourceNodeId}-${entry.targetNodeId}-${entry.step}`}
            // fadeFromLine: chỉ áp dụng nếu là unresolved/raw và có relative call line
            fadeFromLine={
              entry.type === "call"
                ? undefined
                : callLineRelative && entry.type !== "return"
                ? callLineRelative
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
};

export default ExecutionTraceCard;
