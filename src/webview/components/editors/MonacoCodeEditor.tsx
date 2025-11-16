import React, { useState, useEffect } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { Logger } from "../../../utils/webviewLogger";

// Configure Monaco to use local workers in VSCode webview
declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorkerUrl?: (workerId: string, label: string) => string;
      getWorker?: (workerId: string, label: string) => Worker;
    };
  }
}

interface MonacoCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string;
  readOnly?: boolean;
  lineNumber?: number;
  onLineClick?: (lineNumber: number, lineContent: string) => void;
  onEditorHeightChange?: (height: number) => void;
  nodeId?: string;
  allEdges?: any[];
  fadeFromLine?: number;
  segmentStartLine?: number;
  segmentEndLine?: number;
}

// Global init state
let monacoInitialized = false;
let currentMonacoTheme: string | undefined;

// DEBUG INSTRUMENTATION - counters
let monacoRenderCount = 0;
let monacoMountCount = 0;
let monacoThemeSetCount = 0;
let monacoThemeSkipCount = 0;

const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  value,
  onChange,
  language = "go",
  height = "300px",
  readOnly = false,
  lineNumber = 1,
  onLineClick,
  onEditorHeightChange,
  fadeFromLine,
  segmentStartLine,
  segmentEndLine,
  nodeId,
}) => {
  const [isEditorReady, setIsEditorReady] = useState(false);

  // Render counter instrumentation
  try {
    monacoRenderCount++;
    Logger.debug(`[MonacoCodeEditor] RENDER #${monacoRenderCount}`, {
      nodeId,
      valueLength: value?.length,
      language,
      isEditorReady,
      monacoInitialized,
    });
  } catch {}

  useEffect(() => {
    Logger.debug(`[MonacoCodeEditor] useEffect triggered`, {
      nodeId,
      monacoInitialized,
      isEditorReady,
    });

    if (monacoInitialized) {
      setIsEditorReady(true);
      Logger.debug(`[MonacoCodeEditor] Monaco already initialized`, { nodeId });
      return;
    }

    Logger.debug(`[MonacoCodeEditor] Initializing Monaco...`, { nodeId });

    try {
      loader.config({
        paths: {
          vs: "./vs",
        },
        "vs/nls": {
          availableLanguages: {},
        },
      });

      loader
        .init()
        .then(() => {
          monacoInitialized = true;
          setIsEditorReady(true);
          Logger.debug(`[MonacoCodeEditor] Monaco init SUCCESS`, { nodeId });
        })
        .catch((err) => {
          Logger.error(`[MonacoCodeEditor] Monaco init FAILED:`, {
            nodeId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        });
    } catch (err) {
      Logger.error(`[MonacoCodeEditor] Monaco config EXCEPTION:`, {
        nodeId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }, []);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    monacoMountCount++;
    Logger.debug(`[MonacoCodeEditor] MOUNT #${monacoMountCount}`, {
      nodeId,
      editorId: editor.getId?.(),
      modelUri: editor.getModel()?.uri?.toString?.(),
      lineCount: editor.getModel()?.getLineCount?.(),
    });

    // Cursor position -> line click (kept, but without visual gutter decorations)
    if (onLineClick) {
      let cursorIntentTimeout: any = null;
      editor.onDidChangeCursorPosition((e: any) => {
        if (e.source !== "mouse" && e.reason !== 3) {
          return;
        }

        try {
          const selection = editor.getSelection();
          if (!selection) return;

          const hasActiveSelection =
            selection.startLineNumber !== selection.endLineNumber ||
            selection.startColumn !== selection.endColumn;

          if (hasActiveSelection) {
            Logger.debug(
              `[MonacoCodeEditor] Skipping - active text selection`,
              {
                nodeId,
                selection: {
                  start: `${selection.startLineNumber}:${selection.startColumn}`,
                  end: `${selection.endLineNumber}:${selection.endColumn}`,
                },
              }
            );
            return;
          }
        } catch (selErr) {
          Logger.warn(`[MonacoCodeEditor] Selection check failed`, {
            nodeId,
            error: selErr instanceof Error ? selErr.message : String(selErr),
          });
          return;
        }

        if (cursorIntentTimeout) {
          clearTimeout(cursorIntentTimeout);
        }
        cursorIntentTimeout = setTimeout(() => {
          const isReady = (window as any).__goflowEffectiveGraphReady;
          const globalEdges = (window as any).__goflowEdges || [];
          const globalNodes = (window as any).__goflowNodes || [];

          Logger.debug(`[MonacoCodeEditor] Processing line click`, {
            nodeId,
            isReady,
            globalEdgeCount: globalEdges.length,
            globalNodeCount: globalNodes.length,
            sessionId: (window as any).__goflowSessionId,
          });

          if (!isReady) {
            Logger.debug(
              `[MonacoEditor] Graph not ready - queuing line click`,
              {
                nodeId,
                pendingLineClick: !!(window as any).__goflowPendingLineClick,
                pendingNodeHighlight: (window as any)
                  .__goflowPendingNodeHighlight,
              }
            );
            return;
          }

          const absoluteLine = e.position.lineNumber;
          const relativeLine = absoluteLine - lineNumber + 1;

          if (relativeLine < 1) {
            Logger.warn(`[MonacoEditor] Invalid relative line`, {
              nodeId,
              absoluteLine,
              lineNumber,
              relativeLine,
            });
            return;
          }

          const model = editor.getModel();
          const lineContent =
            model?.getLineContent(relativeLine) ||
            model?.getLineContent(absoluteLine) ||
            "";

          Logger.debug(`[MonacoEditor] Triggering line click`, {
            nodeId,
            absoluteLine,
            relativeLine,
            lineContent: lineContent.substring(0, 100),
          });

          onLineClick(relativeLine, lineContent);
        }, 150);
      });
    }

    // Force dark theme
    const themeName = "vs-dark";
    try {
      if (currentMonacoTheme !== themeName) {
        monacoThemeSetCount++;
        monaco.editor.setTheme(themeName);
        currentMonacoTheme = themeName;
        (window as any).__monacoAppliedTheme = themeName;
        Logger.debug(`[MonacoCodeEditor] Theme SET to ${themeName}`, {
          nodeId,
          themeSetCount: monacoThemeSetCount,
        });
      } else {
        monacoThemeSkipCount++;
        if (monacoThemeSkipCount % 10 === 0) {
          Logger.debug(
            `[MonacoCodeEditor] Theme SKIPPED (already ${themeName})`,
            {
              nodeId,
              themeSkipCount: monacoThemeSkipCount,
            }
          );
        }
      }
    } catch (e) {
      Logger.error(`[MonacoCodeEditor] Theme setup FAILED`, {
        nodeId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Dynamic height calculation (unchanged)
    const lineHeight = 19;
    const maxLines = 25;
    const maxHeight = lineHeight * maxLines;
    const minHeight = lineHeight * 3;

    const updateEditorHeight = () => {
      const model = editor.getModel();
      if (!model) return;
      const actualLineCount = model.getLineCount();
      const targetLineCount = Math.min(actualLineCount, maxLines);
      const targetHeight = Math.max(
        minHeight,
        targetLineCount * lineHeight + 16
      );

      editor.layout({
        width: editor.getLayoutInfo().width,
        height: targetHeight,
      });

      if (onEditorHeightChange) {
        onEditorHeightChange(targetHeight);
      }
    };

    updateEditorHeight();
    editor.onDidContentSizeChange(updateEditorHeight);

    if (lineNumber > 1) {
      editor.revealLineInCenter(1);
    }
  };

  const handleChange = (v: string | undefined) => {
    if (v !== undefined) {
      onChange(v);
    }
  };

  return (
    <div style={{ width: "100%", height }}>
      <Editor
        height="100%"
        language={language}
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        loading={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--vscode-editor-foreground)",
              fontSize: "12px",
            }}
          >
            Loading editor...
          </div>
        }
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          fontFamily: "'Courier New', monospace",
          lineHeight: 19,
          // Remove gutter: disable line numbers completely
          lineNumbers: (editorLineNumber: number) =>
            String(lineNumber + editorLineNumber - 1),
          // Increase gutter width so code doesn't overlap padded line numbers
          lineNumbersMinChars: 4,
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          renderLineHighlight: "none",
          scrollbar: {
            vertical: "hidden",
            horizontal: "auto",
            verticalScrollbarSize: 0,
            horizontalScrollbarSize: 8,
            alwaysConsumeMouseWheel: false,
          },
          automaticLayout: true,
          wordWrap: "off",
          wrappingIndent: "none",
          tabSize: 4,
          insertSpaces: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
};

export default MonacoCodeEditor;
