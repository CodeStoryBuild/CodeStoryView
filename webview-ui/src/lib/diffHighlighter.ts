/**
 * Utility for heuristical token colorization of code lines.
 * Uses a universal regex to identify common syntax patterns across multiple languages.
 */

const UNIVERSAL_REGEX =
  /(?<comment>\/\/.*|\/\*[\s\S]*?\*\/|#.*)|(?<string>"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`)|(?<keyword>\b(?:if|else|for|while|return|class|interface|type|enum|def|function|async|await|var|let|const|import|export|from|public|private|static|readonly|namespace|package|using|try|catch|finally|throw|new|delete|in|of|as|is|extends|implements)\b)|(?<type>\b(?:string|number|boolean|any|void|never|unknown|object|int|float|double|char|long|short|byte|bool|true|false|null|undefined)\b)|(?<number>\b\d+(\.\d+)?\b)|(?<operator>[+\-*\/%&|^!<>]=?|==|=>|\?\?|\.\.)|(?<call>\b\w+(?=\())/g;

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
    if (!content) return "";

    const indicator = content[0];
    const isDiffIndicator = indicator === "+" || indicator === "-";
    const rest = content.slice(1);

    let html = "";
    if (isDiffIndicator) {
      html = `<span class="di">${indicator}</span><span class="di-s"> </span>`;
    } else {
      html = `<span class="di">&nbsp;</span><span class="di-s"> </span>`;
    }

    let lastIndex = 0;
    // Reset regex index
    UNIVERSAL_REGEX.lastIndex = 0;
    const matches = Array.from(rest.matchAll(UNIVERSAL_REGEX));

    for (const match of matches) {
      // Add text before the match
      html += this.escape(rest.slice(lastIndex, match.index));

      // Identify which named group matched
      const groups = match.groups as { [key: string]: string | undefined };
      let className = "";
      if (groups.comment) className = "c";
      else if (groups.string) className = "s";
      else if (groups.keyword) className = "k";
      else if (groups.type) className = "t";
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
    html += this.escape(rest.slice(lastIndex));
    return html;
  }
}
