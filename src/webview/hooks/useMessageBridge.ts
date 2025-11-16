import { useEffect } from "react";
import type { FlowEdge, FlowNode } from "../types/flowGraph";

/**
 * Centralizes window message -> graph actions wiring.
 * Extracted from FlowGraph for readability & testability.
 */
export interface UseMessageBridgeParams {
  renderGraph: (data: any, fileName?: string) => Promise<void>;
  handleHighlightEdge: (sourceNodeId: string, targetNodeId: string) => void;
  handleClearHighlight: () => void;
  handleNodeHighlight: (targetNodeId: string) => void;
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

  isGraphReady: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];

  setNodes: (value: FlowNode[] | ((curr: FlowNode[]) => FlowNode[])) => void;
  setEdges: (value: FlowEdge[] | ((curr: FlowEdge[]) => FlowEdge[])) => void;
  setEnableJumpToFile: (v: boolean) => void;

  // Refs needed for instrumentation / buffering
  queuedEdgeHighlightCountRef: React.MutableRefObject<number>;
  prevNodesRef: React.MutableRefObject<FlowNode[]>;
  prevEdgesRef: React.MutableRefObject<FlowEdge[]>;
  midReloadRef: React.MutableRefObject<boolean>;
  sessionCounterRef: React.MutableRefObject<number>;
  currentSessionIdRef: React.MutableRefObject<number>;
  renderInvocationCountRef: React.MutableRefObject<number>;

  logToExtension: (
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    message: string,
    data?: any
  ) => void;
}

/**
 * Attaches a single window message listener translating extension -> graph actions.
 * Keeps FlowGraph component lean.
 */
export default function useMessageBridge(params: UseMessageBridgeParams) {
  const {
    renderGraph,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    handleCallEdge,
    recordUnresolvedCalls,
    recordRawLine,
    isGraphReady,
    nodes,
    edges,
    setNodes,
    setEdges,
    setEnableJumpToFile,
    queuedEdgeHighlightCountRef,
    prevNodesRef,
    prevEdgesRef,
    midReloadRef,
    sessionCounterRef,
    currentSessionIdRef,
    renderInvocationCountRef,
    logToExtension,
  } = params;

  useEffect(() => {
    const messageHandler = async (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message.command !== "string") {
        return;
      }
      try {
        switch (message.command) {
          case "setNodeDraggable":
            setNodes((curr) =>
              curr.map((n) =>
                n.id === message.nodeId
                  ? { ...n, draggable: !!message.draggable }
                  : n
              )
            );
            break;

          case "renderGraph":
            // Instrumentation + session tracking
            sessionCounterRef.current += 1;
            currentSessionIdRef.current = sessionCounterRef.current;
            (window as any).__goflowSessionId = currentSessionIdRef.current;
            logToExtension("DEBUG", "[FlowGraph] renderGraph init", {
              sessionId: currentSessionIdRef.current,
              invocation: renderInvocationCountRef.current + 1,
              prevReadyState: isGraphReady,
              timestamp: Date.now(),
              prevNodeCount: nodes.length,
              prevEdgeCount: edges.length,
            });

            // Invalidate global readiness
            (window as any).__goflowGraphReady = false;
            (window as any).__goflowEffectiveGraphReady = false;
            (window as any).__goflowEdges = [];
            (window as any).__goflowEdgesClearedAt = Date.now();

            // Buffer previous graph
            try {
              prevNodesRef.current = nodes;
              prevEdgesRef.current = edges;
              midReloadRef.current = true;
              (window as any).__goflowPrevSessionBuffered = {
                nodeCount: prevNodesRef.current.length,
                edgeCount: prevEdgesRef.current.length,
                sessionId: currentSessionIdRef.current - 1,
              };
            } catch {}

            if (message.config) {
              setEnableJumpToFile(message.config.enableJumpToFile);
            }

            // Theme payload handled in FlowGraph (kept minimal here)

            await renderGraph(message.data, message.data?.fileName);
            break;

          case "refresh":
            if (message.data) {
              await renderGraph(message.data, message.data?.fileName);
            }
            break;

          case "highlightEdge": {
            // Readiness gating & queuing
            const globalReady = !!(window as any).__goflowGraphReady;
            const globalEdges = (window as any).__goflowEdges;
            const globalEdgeCount = Array.isArray(globalEdges)
              ? globalEdges.length
              : 0;
            const effectiveReady =
              isGraphReady && nodes.length > 0 && edges.length > 0;
            const fallbackReady =
              globalReady && globalEdgeCount > 0 && nodes.length === 0;

            if (!effectiveReady && !fallbackReady) {
              queuedEdgeHighlightCountRef.current += 1;
              const pending =
                (window as any).__goflowPendingEdgeHighlights || [];
              pending.push({
                source: message.sourceNodeId,
                target: message.targetNodeId,
              });
              (window as any).__goflowPendingEdgeHighlights = pending;
              if (
                queuedEdgeHighlightCountRef.current === 1 ||
                queuedEdgeHighlightCountRef.current % 5 === 0
              ) {
                logToExtension("DEBUG", "[FlowGraph] Queue edge highlight", {
                  source: message.sourceNodeId,
                  target: message.targetNodeId,
                  queuedEvents: queuedEdgeHighlightCountRef.current,
                  pendingLength: pending.length,
                  reactReady: isGraphReady,
                  reactNodeCount: nodes.length,
                  reactEdgeCount: edges.length,
                  globalReady,
                  globalEdgeCount,
                });
              }
              return;
            }

            if (
              fallbackReady &&
              prevNodesRef.current.length > 0 &&
              prevEdgesRef.current.length > 0
            ) {
              logToExtension(
                "INFO",
                "[FlowGraph] Fallback buffered graph for edge highlight",
                {
                  bufferedNodeCount: prevNodesRef.current.length,
                  bufferedEdgeCount: prevEdgesRef.current.length,
                }
              );
              setNodes(prevNodesRef.current);
              setEdges(prevEdgesRef.current);
            }

            handleHighlightEdge(message.sourceNodeId, message.targetNodeId);
            handleCallEdge(
              message.sourceNodeId,
              message.targetNodeId,
              typeof message.sourceCallLine === "number"
                ? message.sourceCallLine
                : undefined
            );
            break;
          }

          case "clearHighlight":
            handleClearHighlight();
            break;

          case "recordTraceLine":
            if (
              Array.isArray(message.functionCalls) &&
              typeof message.relativeLine === "number"
            ) {
              recordUnresolvedCalls(
                message.sourceNodeId,
                message.relativeLine,
                message.functionCalls,
                message.lineContent
              );
            }
            break;

          case "recordTraceLineRaw":
            if (typeof message.relativeLine === "number") {
              recordRawLine(
                message.sourceNodeId,
                message.relativeLine,
                message.lineContent
              );
            }
            break;

          case "tracePathForLineClick":
            handleNodeHighlight(message.targetNodeId);
            break;

          default:
            logToExtension("DEBUG", "[FlowGraph] Ignored unknown command", {
              command: message.command,
            });
        }
      } catch (err) {
        logToExtension("ERROR", "[FlowGraph] message handler failure", {
          error: err instanceof Error ? err.message : String(err),
          command: message.command,
        });
      }
    };

    window.addEventListener("message", messageHandler);
    return () => window.removeEventListener("message", messageHandler);
  }, [
    renderGraph,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    handleCallEdge,
    recordUnresolvedCalls,
    recordRawLine,
    isGraphReady,
    nodes,
    edges,
    setNodes,
    setEdges,
    setEnableJumpToFile,
    queuedEdgeHighlightCountRef,
    prevNodesRef,
    prevEdgesRef,
    midReloadRef,
    sessionCounterRef,
    currentSessionIdRef,
    renderInvocationCountRef,
    logToExtension,
  ]);
}
