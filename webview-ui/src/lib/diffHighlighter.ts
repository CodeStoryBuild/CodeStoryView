/**
 * Utility for heuristical token colorization of code lines.
 * Uses a universal regex to identify common syntax patterns across multiple languages.
 */

const UNIVERSAL_REGEX =
  /(?<comment>\/\/.*|\/\*[\s\S]*?\*\/|#.*)|(?<string>"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')|(?<keyword>\b(?:if|else|for|while|return|class|def|function|var|let|const|import|from|public|private|static)\b)|(?<number>\b\d+(\.\d+)?\b)|(?<operator>[+\-*\/%&|^!<>]=?|==|=>)|(?<call>\b\w+(?=\())/g;

export class DiffHighlighter {
  /**
   * Escapes special HTML characters to prevent XSS and rendering issues.
   */
  private static escape(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Runs the universal regex against the isolated string and wraps matched
   * capture groups in <span> tags assigned to specific category classes.
   */
  public static highlight(content: string): string {
    let lastIndex = 0;
    let html = "";

    // Reset regex index
    UNIVERSAL_REGEX.lastIndex = 0;
    const matches = Array.from(content.matchAll(UNIVERSAL_REGEX));

    for (const match of matches) {
      // Add text before the match
      html += this.escape(content.slice(lastIndex, match.index));

      // Identify which named group matched
      const groups = match.groups as { [key: string]: string | undefined };
      let className = "";
      if (groups.comment) className = "c";
      else if (groups.string) className = "s";
      else if (groups.keyword) className = "k";
      else if (groups.number) className = "n";
      else if (groups.operator) className = "o";
      else if (groups.call) className = "f";

      if (className) {
        html += `<span class="${className}">${this.escape(match[0])}</span>`;
      } else {
        html += this.escape(match[0]);
      }

      lastIndex = match.index! + match[0].length;
    }

    // Add remaining text
    html += this.escape(content.slice(lastIndex));
    return html;
  }
}
