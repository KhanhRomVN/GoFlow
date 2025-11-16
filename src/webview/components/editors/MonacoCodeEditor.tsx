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

// Biến toàn cục để theo dõi trạng thái khởi tạo
let monacoInitialized = false;
let currentMonacoTheme: string | undefined;

// DEBUG INSTRUMENTATION - Enhanced counters
let monacoRenderCount = 0;
let monacoMountCount = 0;
let monacoThemeSetCount = 0;
let monacoThemeSkipCount = 0;
let monacoFunctionDecoApplyCount = 0;
let monacoSegmentDecoApplyCount = 0;

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

    // Listen to cursor position changes
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

        // Debounce rapid cursor moves
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
            lineContent: lineContent.substring(0, 100), // First 100 chars
          });

          onLineClick(relativeLine, lineContent);
        }, 150);
      });
    }

    // FORCE DARK THEME - No brightness detection to avoid theme switching bugs
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
          // Log every 10th skip to reduce noise
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

    // Stable decoration ID holders to prevent flicker during text selection caused by full decoration flushes.
    // Using previous IDs lets Monaco diff decorations incrementally instead of clearing/repainting everything.
    let functionCallDecorationIds: string[] = [];
    let segmentFadeDecorationIds: string[] = [];

    // Apply decorations for function call lines (stable diff to avoid flicker)
    const applyFunctionCallDecorations = () => {
      const model = editor.getModel();
      if (!model) {
        Logger.warn(`[MonacoCodeEditor] No model for decorations`, { nodeId });
        return;
      }

      Logger.debug(`[MonacoCodeEditor] Applying function call decorations`, {
        nodeId,
        lineCount: model.getLineCount(),
        previousDecorationCount: functionCallDecorationIds.length,
      });

      const newDecorations: any[] = [];
      const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

      for (let i = 1; i <= model.getLineCount(); i++) {
        const lineContent = model.getLineContent(i);
        const matches = Array.from(
          lineContent.matchAll(functionCallRegex)
        ) as RegExpMatchArray[];
        if (matches.length === 0) continue;

        const trimmedLine = lineContent.trim();
        if (trimmedLine.startsWith("//")) continue;
        if (trimmedLine.startsWith("func ")) continue;

        matches.forEach((match, idx) => {
          const functionName = match[1];
          const keywords = [
            "if",
            "for",
            "switch",
            "return",
            "defer",
            "go",
            "select",
            "case",
            "range",
          ];
          if (keywords.includes(functionName)) return;

          const charIndex = match.index ?? 0;
          const hasReturnValue = detectReturnValueUsage(
            lineContent,
            charIndex,
            functionName
          );
          const badgeColor = hasReturnValue ? "#10b981" : "#6b7280";

          newDecorations.push({
            range: new monaco.Range(i, 1, i, 1),
            options: {
              isWholeLine: true,
              className: "function-call-line",
              glyphMarginClassName: "function-call-glyph",
              glyphMarginHoverMessage: {
                value: `**Calls:** ${functionName}()`,
              },
              overviewRuler: {
                color: badgeColor,
                position: monaco.editor.OverviewRulerLane.Left,
              },
              minimap: {
                color: badgeColor,
                position: monaco.editor.MinimapPosition.Inline,
              },
              linesDecorationsClassName: "function-call-badge",
              before: {
                content: `${idx + 1}`,
                inlineClassName: "function-call-badge-content",
                inlineClassNameAffectsLetterSpacing: true,
              },
            },
          });
        });
      }

      functionCallDecorationIds = editor.deltaDecorations(
        functionCallDecorationIds,
        newDecorations
      );
      monacoFunctionDecoApplyCount++;

      Logger.debug(`[MonacoCodeEditor] Function decorations applied`, {
        nodeId,
        newDecorationCount: newDecorations.length,
        totalDecorationCount: functionCallDecorationIds.length,
        applyCount: monacoFunctionDecoApplyCount,
      });
    };

    // Helper function to detect return value usage
    const detectReturnValueUsage = (
      line: string,
      callPosition: number,
      functionName: string
    ): boolean => {
      const beforeCall = line.substring(0, callPosition).trim();
      const lineUpToCall = line.substring(
        0,
        callPosition + functionName.length
      );

      // Assignment patterns
      if (/:=/.test(lineUpToCall) || /[^=!<>]=(?!=)/.test(lineUpToCall)) {
        return true;
      }

      // Return statement
      if (/\breturn\s+$/.test(beforeCall)) return true;

      // Comparison
      if (/[!=<>]+\s*$/.test(beforeCall)) return true;

      // Function argument
      if (/[,(]\s*$/.test(beforeCall)) return true;

      // Standalone call
      const standalonePattern = /^(\s*)(\w+\.)*\w+\s*$/;
      const checkStr = line
        .substring(0, callPosition + functionName.length)
        .trim();

      if (standalonePattern.test(checkStr)) return false;

      return beforeCall.length > 0 && !/^\s*$/.test(beforeCall);
    };

    // THAY ĐỔI: Tính toán chiều cao dựa trên số dòng thực tế
    const lineHeight = 19; // Monaco default line height
    const maxLines = 25; // Giới hạn tối đa 25 dòng
    const maxHeight = lineHeight * maxLines;
    const minHeight = lineHeight * 3; // Tối thiểu 3 dòng

    // Update editor height based on actual line count
    const updateEditorHeight = () => {
      const model = editor.getModel();
      if (!model) return;

      // Lấy số dòng thực tế trong code
      const actualLineCount = model.getLineCount();

      // Tính chiều cao dựa trên số dòng thực tế, nhưng cap ở maxLines
      const targetLineCount = Math.min(actualLineCount, maxLines);
      const targetHeight = Math.max(
        minHeight,
        targetLineCount * lineHeight + 16
      ); // +16 cho padding top/bottom (8px each) từ Monaco options

      // Layout editor với chiều cao mới
      editor.layout({
        width: editor.getLayoutInfo().width,
        height: targetHeight,
      });

      // Thông báo về parent node để update node height
      if (onEditorHeightChange) {
        onEditorHeightChange(targetHeight);
      }
    };

    // Initial height update
    updateEditorHeight();

    // Update height when content changes
    editor.onDidContentSizeChange(updateEditorHeight);

    // MỚI: Apply decorations sau khi editor ready
    applyFunctionCallDecorations();

    // NEW SEGMENT HIGHLIGHTING:
    // If segmentStartLine & segmentEndLine provided:
    //  - Lines < segmentStartLine => faded (past)
    //  - Lines > segmentEndLine   => faded (future)
    // Else fallback to legacy fadeFromLine behavior.
    const applySegmentFadeDecorations = () => {
      const model = editor.getModel();
      if (!model) return;
      const totalLines = model.getLineCount();
      const newDecorations: any[] = [];

      if (
        typeof segmentStartLine === "number" &&
        segmentStartLine >= 1 &&
        typeof segmentEndLine === "number" &&
        segmentEndLine >= segmentStartLine
      ) {
        for (let i = 1; i <= totalLines; i++) {
          if (i < segmentStartLine || i > segmentEndLine) {
            newDecorations.push({
              range: new monaco.Range(i, 1, i, 1),
              options: {
                isWholeLine: true,
                className: "execution-fade-line",
              },
            });
          }
        }
      } else if (
        typeof fadeFromLine === "number" &&
        fadeFromLine >= 1 &&
        fadeFromLine <= totalLines
      ) {
        for (let i = fadeFromLine + 1; i <= totalLines; i++) {
          newDecorations.push({
            range: new monaco.Range(i, 1, i, 1),
            options: {
              isWholeLine: true,
              className: "execution-fade-line",
            },
          });
        }
      }

      if (
        typeof segmentEndLine === "number" &&
        segmentEndLine >= 1 &&
        segmentEndLine <= totalLines
      ) {
        newDecorations.push({
          range: new monaco.Range(segmentEndLine, 1, segmentEndLine, 1),
          options: {
            isWholeLine: true,
            className: "function-call-line",
          },
        });
      } else if (
        typeof fadeFromLine === "number" &&
        fadeFromLine >= 1 &&
        fadeFromLine <= totalLines
      ) {
        newDecorations.push({
          range: new monaco.Range(fadeFromLine, 1, fadeFromLine, 1),
          options: {
            isWholeLine: true,
            className: "function-call-line",
          },
        });
      }

      segmentFadeDecorationIds = editor.deltaDecorations(
        segmentFadeDecorationIds,
        newDecorations
      );
      monacoSegmentDecoApplyCount++;
    };

    applySegmentFadeDecorations();

    // MỚI: Re-apply decorations when content changes
    editor.onDidChangeModelContent(() => {
      applyFunctionCallDecorations();
      applySegmentFadeDecorations();
    });

    // Set line number offset if needed
    if (lineNumber > 1) {
      editor.revealLineInCenter(1);
    }
  };

  const handleChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
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
          lineNumbers: (editorLineNumber) =>
            String(lineNumber + editorLineNumber - 1),
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 4,
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
