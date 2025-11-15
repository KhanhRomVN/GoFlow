import React, { useState, useEffect } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { Logger } from "../../utils/webviewLogger";

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
  nodeId?: string; // MỚI: Node ID để lấy edges từ EdgeTracker
  allEdges?: any[]; // MỚI: Danh sách edges (có thể lấy từ EdgeTracker)
  fadeFromLine?: number; // NEW: lines after this relative line will be visually faded
}

// Biến toàn cục để theo dõi trạng thái khởi tạo
let monacoInitialized = false;

const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  value,
  onChange,
  language = "go",
  height = "300px",
  readOnly = false,
  lineNumber = 1,
  onLineClick,
  onEditorHeightChange, // THÊM prop mới
  fadeFromLine,
}) => {
  const [isEditorReady, setIsEditorReady] = useState(false);

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

        // If background is light-colored, use light theme
        if (bgColor && bgColor.startsWith("#")) {
          const r = parseInt(bgColor.slice(1, 3), 16);
          const g = parseInt(bgColor.slice(3, 5), 16);
          const b = parseInt(bgColor.slice(5, 7), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          themeName = brightness > 128 ? "vs" : "vs-dark";
        }
      }
    } catch (err) {
      Logger.error("[MonacoCodeEditor] Error detecting theme:", err);
    }

    monaco.editor.setTheme(themeName);

    // MỚI: Apply decorations cho function call lines
    const applyFunctionCallDecorations = () => {
      const model = editor.getModel();
      if (!model) return;

      const decorations: any[] = [];
      const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

      // Duyệt qua từng dòng để tìm function calls
      for (let i = 1; i <= model.getLineCount(); i++) {
        const lineContent = model.getLineContent(i);
        const matches = Array.from(
          lineContent.matchAll(functionCallRegex)
        ) as RegExpMatchArray[];

        if (matches.length > 0) {
          // Kiểm tra xem có phải là function call thực sự không
          const trimmedLine = lineContent.trim();

          // Bỏ qua comment lines
          if (trimmedLine.startsWith("//")) continue;

          // Bỏ qua function declarations
          if (trimmedLine.startsWith("func ")) continue;

          matches.forEach((match, idx) => {
            const functionName = match[1];

            // Skip Go keywords
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

            // Xác định màu sắc: solid (có return) vs dashed (void)
            const hasReturnValue = detectReturnValueUsage(
              lineContent,
              charIndex,
              functionName
            );
            const badgeColor = hasReturnValue ? "#10b981" : "#6b7280"; // Green vs Gray
            const lineColor = hasReturnValue
              ? "rgba(16, 185, 129, 0.1)"
              : "rgba(107, 114, 128, 0.1)";

            // Thêm line background decoration
            decorations.push({
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
      }

      editor.deltaDecorations([], decorations);
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

    // NEW: apply fade decorations if simulation provided fadeFromLine
    const applyFadeDecorations = () => {
      const model = editor.getModel();
      if (!model || typeof fadeFromLine !== "number" || fadeFromLine < 1)
        return;

      const totalLines = model.getLineCount();
      const fadeDecorations = [];
      for (let i = fadeFromLine + 1; i <= totalLines; i++) {
        fadeDecorations.push({
          range: new monaco.Range(i, 1, i, 1),
          options: {
            isWholeLine: true,
            className: "execution-fade-line",
          },
        });
      }
      editor.deltaDecorations([], fadeDecorations);
    };

    applyFadeDecorations();

    // MỚI: Re-apply decorations when content changes
    editor.onDidChangeModelContent(() => {
      applyFunctionCallDecorations();
      applyFadeDecorations();
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
