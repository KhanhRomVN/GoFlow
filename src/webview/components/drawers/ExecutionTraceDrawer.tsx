import React, { useMemo, useState, useCallback, useEffect } from "react";
import "../../styles/node-visibility-drawer.css"; // Reuse base styles + extended execution styles
import ExecutionTraceCard from "../cards/ExecutionTraceCard";

/**
 * ExecutionTraceEntry represents a dynamic step in the execution flow.
 * For a 'call' entry:
 *  - sourceNodeId: caller
 *  - targetNodeId: callee
 *  - sourceCode: full caller code snapshot
 *  - targetCode: full callee code snapshot (optional if unresolved)
 *  - sourceCallLine: relative line (1-based inside source function) where call occurs
 * For a 'return' entry:
 *  - Represents return from callee back to caller (edges with returnOrder)
 */
export interface ExecutionTraceEntry {
  step?: number;
  type?: "call" | "return" | "unresolved" | "raw";
  sourceNodeId: string;
  targetNodeId: string;
  sourceCallLine?: number;
  sourceLineContent?: string;
  sourceCode?: string;
  targetCode?: string;
  timestamp: number;
  sourceStartLine?: number;
  targetStartLine?: number;
  /**
   * Deprecated: replaced by highlightSegmentStartRelativeLine / highlightSegmentEndRelativeLine
   */
  highlightUntilRelativeLine?: number;
  /**
   * NEW: Relative start line (1-based inside caller function code) of the bright segment.
   * Lines before this line are dimmed (already executed earlier).
   */
  highlightSegmentStartRelativeLine?: number;
  /**
   * NEW: Relative end line (1-based inside caller function code) of the bright segment.
   * Lines after this line are dimmed (future / not yet executed at this snapshot).
   */
  highlightSegmentEndRelativeLine?: number;
}

/**
 * Props for ExecutionTraceDrawer
 */
interface ExecutionTraceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  trace: ExecutionTraceEntry[];
  onClear: () => void;
  onJumpToNode: (nodeId: string) => void;
  rootNodeId?: string;
  rootCode?: string;
  rootStartLine?: number;
}

/**
 * ExecutionTraceDrawer
 * Renders a side drawer (no overlay; persistent) containing sequential "cards"
 * for function execution steps. Each card shows code with:
 *  - Executed lines up to the call highlighted
 *  - The call line emphasized
 *  - Future (not-yet-executed) lines dimmed
 */
const ExecutionTraceDrawer: React.FC<ExecutionTraceDrawerProps> = ({
  isOpen,
  onClose,
  trace,
  onClear,
  onJumpToNode,
  rootNodeId,
  rootCode,
  rootStartLine,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [wideMode, setWideMode] = useState(false);

  // Build initial pseudo entry for root if provided and trace has not started
  const rootEntry: ExecutionTraceEntry | undefined = useMemo(() => {
    if (rootNodeId && rootCode && trace.length === 0) {
      return {
        step: 0,
        type: "call",
        sourceNodeId: rootNodeId,
        targetNodeId: rootNodeId,
        sourceCode: rootCode,
        sourceStartLine: rootStartLine,
        timestamp: Date.now(),
      };
    }
    return undefined;
  }, [rootNodeId, rootCode, trace.length]);

  // Filter by search
  const filteredTrace = useMemo(() => {
    const base = rootEntry ? [rootEntry, ...trace] : trace;
    if (!searchQuery) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(
      (e) =>
        e.sourceNodeId.toLowerCase().includes(q) ||
        e.targetNodeId.toLowerCase().includes(q) ||
        (e.sourceLineContent &&
          e.sourceLineContent.toLowerCase().includes(q)) ||
        String(e.sourceCallLine || "").includes(q)
    );
  }, [trace, rootEntry, searchQuery]);

  // Normalize step numbering preserving chronological order
  const orderedEntries = useMemo(() => {
    return filteredTrace.map((e, idx) => ({
      ...e,
      step: e.step ?? idx + (rootEntry ? 0 : 1),
    }));
  }, [filteredTrace, rootEntry]);

  // Diagnostics: check sequencing anomalies (return before call, missing line content)
  useEffect(() => {
    let unmatchedReturns = 0;
    let callsMissingContent = 0;

    orderedEntries.forEach((entry, idx) => {
      if (entry.type === "return") {
        const priorCall = [...orderedEntries]
          .slice(0, idx)
          .reverse()
          .find(
            (e) => e.type === "call" && e.targetNodeId === entry.targetNodeId
          );
        if (!priorCall) {
          unmatchedReturns++;
          console.debug(
            "[ExecutionTraceDrawer][Diag] Return without matching prior call",
            entry
          );
        }
      }
      if (
        entry.type === "call" &&
        entry.sourceCallLine &&
        entry.sourceStartLine
      ) {
        const absLine = entry.sourceStartLine + entry.sourceCallLine - 1;
        if (!entry.sourceLineContent) {
          callsMissingContent++;
          console.debug(
            "[ExecutionTraceDrawer][Diag] Missing sourceLineContent for call",
            {
              sourceNodeId: entry.sourceNodeId,
              targetNodeId: entry.targetNodeId,
              sourceCallLine: entry.sourceCallLine,
              sourceStartLine: entry.sourceStartLine,
              absoluteCallLine: absLine,
            }
          );
        }
      }
    });

    // Aggregate summary (helps compare with Canvas flow correctness)
    console.debug("[ExecutionTraceDrawer][DiagSummary]", {
      totalEntries: orderedEntries.length,
      callCount: orderedEntries.filter((e) => e.type === "call").length,
      returnCount: orderedEntries.filter((e) => e.type === "return").length,
      unresolvedCount: orderedEntries.filter((e) => e.type === "unresolved")
        .length,
      rawCount: orderedEntries.filter((e) => e.type === "raw").length,
      unmatchedReturns,
      callsMissingContent,
      hasRootEntry: !!rootEntry,
    });
  }, [orderedEntries, rootEntry]);

  /**
   * Render highlighted code block for an entry.
   * Strategy:
   *  - Lines <= sourceCallLine are "executed": normal brightness
   *  - Line == sourceCallLine (call line) gets highlight class
   *  - Lines > sourceCallLine are faded
   * For entries without sourceCallLine we render code normally.
   */
  const renderCodeBlock = useCallback((entry: ExecutionTraceEntry) => {
    const code = entry.targetCode || entry.sourceCode;
    if (!code) return null;
    const lines = code.split("\n");
    const callLine = entry.sourceCallLine || 0;

    return (
      <pre className="execution-trace-code">
        {lines.map((l, i) => {
          const lineNo = i + 1;
          const isCallLine = callLine > 0 && lineNo === callLine;

          // UPDATED RULE:
          //  - Lines before callLine: executed -> normal (not faded)
          //  - Line == callLine: highlight
          //  - Lines after callLine: future -> faded
          //  If no callLine, render all normally.
          let lineClass = "execution-trace-line";
          if (callLine > 0) {
            if (isCallLine) {
              lineClass += " execution-trace-line-call";
            } else if (lineNo > callLine) {
              lineClass += " execution-trace-line-faded";
            }
          }

          return (
            <div
              key={i}
              className={lineClass}
              data-line={lineNo}
              style={{
                display: "flex",
                whiteSpace: "pre",
              }}
            >
              <span className="execution-trace-gutter">
                {String(lineNo).padStart(3, " ")}
              </span>
              <span className="execution-trace-code-text">{l || " "}</span>
            </div>
          );
        })}
      </pre>
    );
  }, []);

  const getBadgeColor = (entry: ExecutionTraceEntry) => {
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

  return (
    <div
      className={`execution-trace-drawer ${isOpen ? "open" : ""} ${
        wideMode ? "wide" : ""
      }`}
    >
      <div className="execution-trace-header">
        <div className="execution-trace-header-left">
          <span className="execution-trace-title-icon">🗒️</span>
          <span className="execution-trace-title">Execution Flow</span>
          <span className="execution-trace-count">{trace.length} steps</span>
        </div>
        <div className="execution-trace-header-right">
          <button
            className="ex-btn"
            title={wideMode ? "Normal width" : "Wide width"}
            onClick={() => setWideMode((p) => !p)}
          >
            {wideMode ? "⬅️" : "➡️"}
          </button>
          <button
            className="ex-btn"
            title="Clear flow"
            disabled={trace.length === 0}
            onClick={onClear}
          >
            ♻️
          </button>
          <button
            className="ex-btn"
            title="Close drawer"
            onClick={onClose}
            style={{ opacity: 0.75 }}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="execution-trace-search">
        <input
          className="execution-trace-search-input"
          placeholder="Search node / line / content..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="execution-trace-list">
        {orderedEntries.length === 0 ? (
          <div className="execution-trace-empty">
            {searchQuery
              ? `No entries match "${searchQuery}"`
              : "No flow yet. Click lines in root function or select nodes to begin building the execution flow."}
          </div>
        ) : (
          orderedEntries.map((entry) => (
            <ExecutionTraceCard
              key={`${entry.step}-${entry.sourceNodeId}-${entry.targetNodeId}-${entry.timestamp}`}
              entry={entry}
              onJumpToNode={onJumpToNode}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default ExecutionTraceDrawer;
