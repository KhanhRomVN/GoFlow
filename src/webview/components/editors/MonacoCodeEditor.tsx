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
  fadeFromLine?: number; // LEGACY: keep for backward compatibility
  segmentStartLine?: number; // NEW: first bright line (relative)
  segmentEndLine?: number; // NEW: last bright line (relative)
}

// Biến toàn cục để theo dõi trạng thái khởi tạo
let monacoInitialized = false;
let currentMonacoTheme: string | undefined;

// DEBUG INSTRUMENTATION
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
}) => {
  const [isEditorReady, setIsEditorReady] = useState(false);

  // Render counter instrumentation
  try {
    monacoRenderCount++;
    Logger.debug("[MonacoCodeEditor][Render] Component render", {
      renderCount: monacoRenderCount,
      valueLength: value?.length,
      language,
      readOnly,
      lineNumber,
      hasFadeFromLine: typeof fadeFromLine === "number",
      segmentStartLine,
      segmentEndLine,
    });
  } catch {}

  useEffect(() => {
    // Chỉ khởi tạo Monaco một lần duy nhất
    if (monacoInitialized) {
      setIsEditorReady(true);
      return;
    }

    // Configure Monaco to load from local media/vs folder
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
        })
        .catch((err) => {
          console.error("[MonacoCodeEditor] Failed to initialize Monaco:", err);
          console.error("[MonacoCodeEditor] Stack:", err?.stack);
        });
    } catch (err) {
      console.error("[MonacoCodeEditor] Exception during Monaco config:", err);
    }
  }, []);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    monacoMountCount++;
    try {
      Logger.debug("[MonacoCodeEditor][Mount] Editor mounted", {
        mountCount: monacoMountCount,
        currentMonacoTheme,
        appliedThemeGlobal: (window as any).__monacoAppliedTheme,
      });
    } catch {}

    // Listen to cursor position changes
    if (onLineClick) {
      editor.onDidChangeCursorPosition((e: any) => {
        const absoluteLine = e.position.lineNumber; // displayed (file) line
        const relativeLine = absoluteLine - lineNumber + 1; // convert to 1-based inside function
        if (relativeLine < 1) {
          return; // safety
        }
        const model = editor.getModel();
        const lineContent =
          model?.getLineContent(relativeLine) ||
          model?.getLineContent(absoluteLine) ||
          "";
        // DEBUG log (webview console only)
        try {
          Logger.debug("[MonacoCodeEditor] Cursor line change", {
            nodeStartLine: lineNumber,
            absoluteLine,
            relativeLine,
            extractedContentSample: lineContent.slice(0, 80),
          });
        } catch {}
        onLineClick(relativeLine, lineContent);
      });
    }

    // Get theme from VSCode API directly
    let themeName = "vs-dark"; // Default to dark theme

    let detectedBgColor: string | undefined;
    let detectedBrightness: number | undefined;

    try {
      // Try to get theme from window object first
      const themeInfo = (window as any).__goflowTheme;

      if (themeInfo && typeof themeInfo.isDark === "boolean") {
        themeName = themeInfo.isDark ? "vs-dark" : "vs";
      } else {
        // Fallback: detect from CSS variables
        const bgColor = getComputedStyle(document.body)
          .getPropertyValue("--vscode-editor-background")
          .trim();
        detectedBgColor = bgColor;

        // If background is light-colored, use light theme
        if (bgColor && bgColor.startsWith("#")) {
          const r = parseInt(bgColor.slice(1, 3), 16);
          const g = parseInt(bgColor.slice(3, 5), 16);
          const b = parseInt(bgColor.slice(5, 7), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          detectedBrightness = brightness;
          themeName = brightness > 128 ? "vs" : "vs-dark";
        }
      }
    } catch (err) {
      Logger.error("[MonacoCodeEditor] Error detecting theme:", err);
    }

    // Apply theme only if different to prevent unnecessary reflows/flicker
    try {
      if (currentMonacoTheme !== themeName) {
        monacoThemeSetCount++;
        Logger.debug("[MonacoCodeEditor][Theme] Applying theme", {
          previous: currentMonacoTheme,
          next: themeName,
          mountCount: monacoMountCount,
          renderCount: monacoRenderCount,
          themeSetCount: monacoThemeSetCount,
          themeSkipCount: monacoThemeSkipCount,
          detectedBgColor,
          detectedBrightness,
          rawThemeInfo: (window as any).__goflowTheme,
        });
        monaco.editor.setTheme(themeName);
        currentMonacoTheme = themeName;
        (window as any).__monacoAppliedTheme = themeName;
      } else {
        monacoThemeSkipCount++;
        Logger.debug("[MonacoCodeEditor][Theme] Unchanged - skip setTheme", {
          themeName,
          mountCount: monacoMountCount,
          renderCount: monacoRenderCount,
          themeSetCount: monacoThemeSetCount,
          themeSkipCount: monacoThemeSkipCount,
          detectedBgColor,
          detectedBrightness,
        });
      }
    } catch (e) {
      Logger.error("[MonacoCodeEditor] Failed to set theme", e);
    }
    // Stable decoration ID holders to prevent flicker during text selection caused by full decoration flushes.
    // Using previous IDs lets Monaco diff decorations incrementally instead of clearing/repainting everything.
    let functionCallDecorationIds: string[] = [];
    let segmentFadeDecorationIds: string[] = [];

    // Apply decorations for function call lines (stable diff to avoid flicker)
    const applyFunctionCallDecorations = () => {
      const model = editor.getModel();
      if (!model) return;

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
      try {
        Logger.debug("[MonacoCodeEditor][Decorations] Function calls applied", {
          count: newDecorations.length,
          applyCount: monacoFunctionDecoApplyCount,
          modelLineCount: model.getLineCount(),
        });
      } catch {}
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
      try {
        Logger.debug("[MonacoCodeEditor][Decorations] Segment fade applied", {
          count: newDecorations.length,
          applyCount: monacoSegmentDecoApplyCount,
          segmentStartLine,
          segmentEndLine,
          fadeFromLine,
        });
      } catch {}
    };

    applySegmentFadeDecorations();

    // MỚI: Re-apply decorations when content changes
    editor.onDidChangeModelContent(() => {
      applyFunctionCallDecorations();
      applySegmentFadeDecorations();
      try {
        Logger.debug("[MonacoCodeEditor][ModelContent] Content changed", {
          mountCount: monacoMountCount,
          renderCount: monacoRenderCount,
          functionDecoApplyCount: monacoFunctionDecoApplyCount,
          segmentDecoApplyCount: monacoSegmentDecoApplyCount,
        });
      } catch {}
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
