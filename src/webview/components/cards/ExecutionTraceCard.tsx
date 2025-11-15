import React, { useMemo, useState, useCallback } from "react";
import { ExecutionTraceEntry } from "../drawers/ExecutionTraceDrawer";
import ExecutionTraceCodeEditor from "../editors/ExecutionTraceCodeEditor";

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
      // CALL: Hiển thị CODE CỦA CALLER để tô sáng các dòng đã chạy đến vị trí gọi
      code = entry.sourceCode;
      startLine = entry.sourceStartLine;
      relCall = entry.sourceCallLine; // dùng để fade phần sau
    } else if (entry.type === "return") {
      // RETURN: vẫn hiển thị caller để có thể minh họa tiến trình sau khi callee trả về (có thể mở rộng sau)
      code = entry.sourceCode || entry.targetCode;
      startLine = entry.sourceStartLine || entry.targetStartLine;
      // Không highlight đặc biệt cho return (có thể mở rộng nếu cần)
      relCall = undefined;
    } else {
      // unresolved/raw: hiển thị source như trước
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

  // Segment highlight (preferred): use explicit segment fields if provided
  const segmentStartLine =
    entry.highlightSegmentStartRelativeLine !== undefined
      ? entry.highlightSegmentStartRelativeLine
      : entry.type === "call" && callLineRelative
      ? 1
      : undefined;

  const segmentEndLine =
    entry.highlightSegmentEndRelativeLine !== undefined
      ? entry.highlightSegmentEndRelativeLine
      : entry.type === "call"
      ? callLineRelative
      : undefined;

  // Legacy fallback: highlightUntilRelativeLine (earlier approach)
  const legacyFadeFromLine =
    segmentStartLine === 1 && segmentEndLine
      ? segmentEndLine
      : entry.highlightUntilRelativeLine;

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
          <ExecutionTraceCodeEditor
            value={codeToRender}
            language="go"
            lineNumber={baseStartLine || 1}
            nodeId={`trace-${entry.sourceNodeId}-${entry.targetNodeId}-${entry.step}`}
            segmentStartLine={segmentStartLine}
            segmentEndLine={segmentEndLine}
            legacyFadeFromLine={legacyFadeFromLine}
            onEditorHeightChange={handleEditorHeightChange}
            height={`${editorHeight}px`}
          />
        )}
      </div>
    </div>
  );
};

export default ExecutionTraceCard;
