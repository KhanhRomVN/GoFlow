import { useCallback, useRef, useState } from "react";
import type {
  FlowEdge,
  FlowNode,
  FunctionNodeData,
  DeclarationNodeData,
} from "../types/flowGraph";
import type { ExecutionTraceEntry } from "../components/drawers/ExecutionTraceDrawer";

/**
 * Encapsulates static + dynamic execution trace building & management.
 * Preserves previous logic but moved out of FlowGraph for readability.
 */
export interface ExecutionTraceManager {
  executionTrace: ExecutionTraceEntry[];
  buildStaticExecutionTrace: (
    flowEdges: FlowEdge[],
    flowNodes: FlowNode[],
    logFn?: LogFn
  ) => void;
  clearTrace: () => void;
  handleCallEdge: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceCallLine?: number
  ) => void;
  recordUnresolvedCalls: (
    sourceNodeId: string,
    relativeLine: number,
    functionCalls: string[],
    lineContent?: string
  ) => void;
  recordRawLine: (
    sourceNodeId: string,
    relativeLine: number,
    lineContent?: string
  ) => void;
  rootNodeId?: string;
  rootCode?: string;
  rootStartLine?: number;
  setRootIfUnset: (flowNodes: FlowNode[]) => void;
}

export type LogFn = (
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,
  data?: any
) => void;

interface UseExecutionTraceOptions {
  logFn?: LogFn;
}

/**
 * Hook providing execution trace management.
 */
export default function useExecutionTrace(
  opts: UseExecutionTraceOptions = {}
): ExecutionTraceManager {
  const { logFn } = opts;
  const [executionTrace, setExecutionTrace] = useState<ExecutionTraceEntry[]>(
    []
  );
  const lastCallEntryRef = useRef<Map<string, ExecutionTraceEntry>>(new Map());
  const rootNodeIdRef = useRef<string | undefined>(undefined);
  const rootCodeRef = useRef<string | undefined>(undefined);
  const rootStartLineRef = useRef<number | undefined>(undefined);

  const log = useCallback(
    (
      level: "DEBUG" | "INFO" | "WARN" | "ERROR",
      message: string,
      data?: any
    ) => {
      if (logFn) {
        try {
          logFn(level, message, data);
        } catch {
          // swallow
        }
      }
    },
    [logFn]
  );

  const findCallLine = (
    sourceCode: string | undefined,
    targetLabel: string | undefined
  ): { relLine?: number; content?: string } => {
    if (!sourceCode || !targetLabel) return {};
    const lines = sourceCode.split("\n");
    const idx = lines.findIndex((l) => l.includes(`${targetLabel}(`));
    if (idx >= 0) return { relLine: idx + 1, content: lines[idx] };
    return {};
  };

  const findNextCallLineAfter = (
    sourceCode: string | undefined,
    afterRelLine: number
  ): number | undefined => {
    if (!sourceCode) return undefined;
    const lines = sourceCode.split("\n");
    const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
    for (let i = afterRelLine; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      if (trimmed.startsWith("func ")) continue;
      if (callRegex.test(raw)) return i + 1;
    }
    return undefined;
  };

  const buildStaticExecutionTrace = useCallback(
    (flowEdges: FlowEdge[], flowNodes: FlowNode[], externalLogFn?: LogFn) => {
      const combinedLog = externalLogFn || log;
      const nodeCodeMap = new Map<string, string>();
      const nodeLabelMap = new Map<string, string>();
      const nodeStartLineMap = new Map<string, number>();
      flowNodes.forEach((n) => {
        if (n.type === "functionNode") {
          const fnData = n.data as FunctionNodeData;
          nodeCodeMap.set(n.id, fnData.code || "");
          nodeLabelMap.set(n.id, fnData.label || n.id);
          nodeStartLineMap.set(n.id, fnData.line);
        } else if (n.type === "declarationNode") {
          const declData = n.data as DeclarationNodeData;
          nodeCodeMap.set(n.id, declData.code || "");
          nodeLabelMap.set(n.id, declData.label || n.id);
          nodeStartLineMap.set(n.id, declData.line);
        }
      });

      const callEntries: ExecutionTraceEntry[] = flowEdges
        .filter(
          (e) =>
            e.type === "callOrderEdge" &&
            e.data &&
            typeof (e.data as any).callOrder === "number"
        )
        .map((e) => {
          const callOrder = (e.data as any).callOrder;
          const sourceCode = nodeCodeMap.get(e.source);
          const targetCode = nodeCodeMap.get(e.target);
          const targetLabel = nodeLabelMap.get(e.target);
          const { relLine, content } = findCallLine(sourceCode, targetLabel);
          return {
            step: callOrder,
            type: "call",
            sourceNodeId: e.source,
            targetNodeId: e.target,
            sourceCallLine: relLine,
            sourceLineContent: content,
            sourceCode,
            targetCode,
            sourceStartLine: nodeStartLineMap.get(e.source),
            targetStartLine: nodeStartLineMap.get(e.target),
            timestamp: Date.now(),
            highlightUntilRelativeLine: relLine,
            highlightSegmentStartRelativeLine: relLine ? 1 : undefined,
            highlightSegmentEndRelativeLine: relLine,
          } as ExecutionTraceEntry;
        });

      const returnEntries: ExecutionTraceEntry[] = flowEdges
        .filter(
          (e) =>
            e.type === "callOrderEdge" &&
            e.data &&
            typeof (e.data as any).returnOrder === "number"
        )
        .map((e) => {
          const returnOrder = (e.data as any).returnOrder;
          const sourceCode = nodeCodeMap.get(e.source);
          const targetCode = nodeCodeMap.get(e.target);
          const priorCall = callEntries.find(
            (c) =>
              c.sourceNodeId === e.source &&
              c.targetNodeId === e.target &&
              typeof c.sourceCallLine === "number"
          );
          const previousCallLine = priorCall?.sourceCallLine;
          let nextCallLine: number | undefined;
          if (typeof previousCallLine === "number") {
            nextCallLine = findNextCallLineAfter(sourceCode, previousCallLine);
          }
          return {
            step: returnOrder,
            type: "return",
            sourceNodeId: e.source,
            targetNodeId: e.target,
            sourceCode,
            targetCode,
            sourceStartLine: nodeStartLineMap.get(e.source),
            targetStartLine: nodeStartLineMap.get(e.target),
            timestamp: Date.now(),
            highlightSegmentStartRelativeLine:
              typeof previousCallLine === "number"
                ? previousCallLine + 1
                : undefined,
            highlightSegmentEndRelativeLine:
              typeof previousCallLine === "number"
                ? nextCallLine || previousCallLine + 1
                : undefined,
          } as ExecutionTraceEntry;
        });

      const merged = [...callEntries, ...returnEntries].sort(
        (a, b) => (a.step ?? 0) - (b.step ?? 0)
      );

      // Correlate anomalies
      const correlationMap: Record<
        string,
        { callStep?: number; returnStep?: number }
      > = {};
      callEntries.forEach((c) => {
        const key = `${c.sourceNodeId}->${c.targetNodeId}`;
        correlationMap[key] = {
          ...(correlationMap[key] || {}),
          callStep: c.step,
        };
      });
      returnEntries.forEach((r) => {
        const key = `${r.sourceNodeId}->${r.targetNodeId}`;
        correlationMap[key] = {
          ...(correlationMap[key] || {}),
          returnStep: r.step,
        };
      });
      const anomalies: any[] = [];
      Object.entries(correlationMap).forEach(([key, v]) => {
        if (v.callStep !== undefined && v.returnStep !== undefined) {
          if ((v.returnStep as number) < (v.callStep as number)) {
            anomalies.push({ key, issue: "RETURN_BEFORE_CALL", data: v });
          }
        } else if (v.callStep !== undefined && v.returnStep === undefined) {
          anomalies.push({ key, issue: "MISSING_RETURN", data: v });
        } else if (v.callStep === undefined && v.returnStep !== undefined) {
          anomalies.push({ key, issue: "RETURN_WITHOUT_CALL", data: v });
        }
      });

      setExecutionTrace(merged);
      combinedLog("INFO", "[ExecutionTrace] Static list built", {
        callCount: callEntries.length,
        returnCount: returnEntries.length,
        total: merged.length,
        anomalyCount: anomalies.length,
      });
      if (anomalies.length > 0) {
        combinedLog("WARN", "[ExecutionTrace] Anomalies detected", {
          anomalies: anomalies.slice(0, 50),
        });
      }
    },
    [log]
  );

  const setRootIfUnset = useCallback(
    (flowNodes: FlowNode[]) => {
      if (!rootNodeIdRef.current) {
        const firstFn = flowNodes.find((n) => n.type === "functionNode");
        if (firstFn) {
          rootNodeIdRef.current = firstFn.id;
          rootCodeRef.current = (firstFn.data as FunctionNodeData).code || "";
          rootStartLineRef.current = (firstFn.data as FunctionNodeData).line;
          log("INFO", "[ExecutionTrace] Root function captured", {
            rootNodeId: rootNodeIdRef.current,
            rootStartLine: rootStartLineRef.current,
          });
        }
      }
    },
    [log]
  );

  const clearTrace = useCallback(() => {
    setExecutionTrace([]);
    lastCallEntryRef.current.clear();
    log("DEBUG", "[ExecutionTrace] Trace cleared");
  }, [log]);

  /**
   * Dynamic CALL edge handling (includes synthetic RETURN for previous call).
   */
  const handleCallEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string, sourceCallLine?: number) => {
      try {
        const prevCall = lastCallEntryRef.current.get(sourceNodeId);
        if (prevCall && typeof prevCall.sourceCallLine === "number") {
          // Synthesize implicit return segment
          const sourceCode = prevCall.sourceCode;
          const nextLine =
            typeof sourceCallLine === "number"
              ? sourceCallLine
              : findNextCallLineAfter(sourceCode, prevCall.sourceCallLine) ||
                prevCall.sourceCallLine + 1;
          const startSeg = prevCall.sourceCallLine + 1;
          const endSeg = nextLine;
          setExecutionTrace((prev) => [
            ...prev,
            {
              step: prev.length + 1,
              type: "return",
              sourceNodeId: prevCall.sourceNodeId,
              targetNodeId: prevCall.targetNodeId,
              sourceCode: prevCall.sourceCode,
              sourceStartLine: prevCall.sourceStartLine,
              timestamp: Date.now(),
              highlightSegmentStartRelativeLine: startSeg,
              highlightSegmentEndRelativeLine: endSeg,
            },
          ]);
        }
      } catch (e) {
        log("WARN", "[ExecutionTrace] Failed synthetic return", e);
      }

      try {
        const sourceCode =
          lastCallEntryRef.current.get(sourceNodeId)?.sourceCode; // may be undefined; best effort
        setExecutionTrace((prev) => {
          const newCall: ExecutionTraceEntry = {
            step: prev.length + 1,
            type: "call",
            sourceNodeId,
            targetNodeId,
            sourceCallLine: sourceCallLine,
            sourceLineContent: undefined,
            sourceCode,
            targetCode: undefined,
            sourceStartLine: undefined,
            targetStartLine: undefined,
            timestamp: Date.now(),
            highlightUntilRelativeLine: sourceCallLine,
            highlightSegmentStartRelativeLine: sourceCallLine ? 1 : undefined,
            highlightSegmentEndRelativeLine: sourceCallLine,
          };
          lastCallEntryRef.current.set(sourceNodeId, newCall);
          return [...prev, newCall];
        });
      } catch (e) {
        log("WARN", "[ExecutionTrace] Failed appending call entry", e);
      }
    },
    [log]
  );

  const recordUnresolvedCalls = useCallback(
    (
      sourceNodeId: string,
      relativeLine: number,
      functionCalls: string[],
      lineContent?: string
    ) => {
      if (!Array.isArray(functionCalls) || typeof relativeLine !== "number")
        return;
      setExecutionTrace((prev) => {
        const entries: ExecutionTraceEntry[] = functionCalls.map((fnName) => ({
          step:
            prev.length + 1 + entriesOffset(prev.length, functionCalls.length),
          type: "unresolved",
          sourceNodeId,
          targetNodeId: `unresolved_${fnName}`,
          sourceCallLine: relativeLine,
          sourceLineContent: lineContent,
          sourceCode: undefined,
          sourceStartLine: undefined,
          timestamp: Date.now(),
        }));
        return [...prev, ...entries];
      });
    },
    []
  );

  const entriesOffset = (current: number, batch: number) => 0; // helper retained for clarity

  const recordRawLine = useCallback(
    (sourceNodeId: string, relativeLine: number, lineContent?: string) => {
      if (typeof relativeLine !== "number") return;
      setExecutionTrace((prev) => [
        ...prev,
        {
          step: prev.length + 1,
          type: "raw",
          sourceNodeId,
          targetNodeId: `raw_line_${relativeLine}`,
          sourceCallLine: relativeLine,
          sourceLineContent: lineContent,
          sourceCode: undefined,
          sourceStartLine: undefined,
          timestamp: Date.now(),
        },
      ]);
    },
    []
  );

  return {
    executionTrace,
    buildStaticExecutionTrace,
    clearTrace,
    handleCallEdge,
    recordUnresolvedCalls,
    recordRawLine,
    rootNodeId: rootNodeIdRef.current,
    rootCode: rootCodeRef.current,
    rootStartLine: rootStartLineRef.current,
    setRootIfUnset,
  };
}
