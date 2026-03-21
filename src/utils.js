import { randomUUID } from "node:crypto";

export function buildPublicName(from) {
  const joined = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return joined || from?.username || `user-${from?.id ?? "unknown"}`;
}

export function slugify(value) {
  return String(value || "unknown")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "unknown";
}

export function buildSessionKey(user, index) {
  if (index === 0) {
    return `tg_${user.telegramUserId}`;
  }

  return `tg${index}_${user.telegramUserId}_${slugify(user.publicName)}`;
}

export function buildSessionLabel(user, index) {
  if (index === 0) {
    return `Default chat for ${user.publicName}`;
  }

  return `Chat ${index} for ${user.publicName}`;
}

export function buildFlowiseChatId() {
  return randomUUID();
}

export function chunkText(text, limit = 3900) {
  const value = String(text ?? "");

  if (value.length <= limit) {
    return [value];
  }

  const chunks = [];
  let remaining = value;

  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit / 2) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt < limit / 2) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

export function formatDateTime(value) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
}

/**
 * Convert standard Markdown (from Flowise AI) to Telegram-compatible HTML.
 * Handles: bold, italic, strikethrough, code blocks, inline code,
 * links, headings, and bullet/numbered lists.
 */
export function markdownToTelegramHtml(text) {
  if (!text) {
    return "";
  }

  let result = String(text);

  // 1. Extract code blocks FIRST to protect them from other transformations
  const codeBlocks = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const content = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`;
    codeBlocks.push(content);
    return placeholder;
  });

  // 2. Extract inline code to protect it
  const inlineCodes = [];
  result = result.replace(/`([^`]+)`/g, (match, content) => {
    const placeholder = `%%INLINE_${inlineCodes.length}%%`;
    inlineCodes.push(content);
    return placeholder;
  });

  // 2b. Extract and convert markdown tables to monospace pre blocks.
  // Telegram has no HTML table support, so we render as aligned text.
  const tableBlocks = [];
  result = result.replace(
    /(?:^\|.+\|[ \t]*\n)+/gm,
    (tableMatch) => {
      const rows = tableMatch.trim().split("\n").map((row) =>
        row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())
      );

      // Remove separator rows (e.g. |---|---|)
      const dataRows = rows.filter(
        (row) => !row.every((cell) => /^[\-:]+$/.test(cell))
      );

      if (dataRows.length === 0) {
        return tableMatch;
      }

      // Calculate column widths
      const colCount = Math.max(...dataRows.map((r) => r.length));
      const widths = Array.from({ length: colCount }, (_, col) =>
        Math.max(...dataRows.map((r) => (r[col] || "").length), 1)
      );

      // Render aligned rows
      const lines = dataRows.map((row) =>
        row.map((cell, col) => (cell || "").padEnd(widths[col])).join("  │  ")
      );

      // Add a separator after the header row
      const separator = widths.map((w) => "─".repeat(w)).join("──┼──");
      const rendered = [lines[0], separator, ...lines.slice(1)].join("\n");

      const placeholder = `%%TABLE_${tableBlocks.length}%%`;
      tableBlocks.push(rendered);
      return placeholder + "\n";
    }
  );

  // 3. Escape HTML special characters in remaining text
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 4. Horizontal rules: --- or *** → thin line
  result = result.replace(/^[\-\*]{3,}\s*$/gm, "──────────");

  // 5. Headings → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // 6. Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // 7. Italic: *text* or _text_ (but not inside words with underscores)
  result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");

  // 8. Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 9. Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 10. Blockquotes: > text → italic with bar
  result = result.replace(/^&gt;\s?(.*)$/gm, "┃ <i>$1</i>");

  // 11. Bullet points: * item or - item at start of line → • item
  result = result.replace(/^[\*\-]\s+/gm, "• ");

  // 12. Numbered lists: clean up extra spaces
  result = result.replace(/^(\d+)\.\s+/gm, "$1. ");

  // 10. Restore inline codes (with HTML-escaped content)
  inlineCodes.forEach((code, i) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    result = result.replace(`%%INLINE_${i}%%`, `<code>${escaped}</code>`);
  });

  // 11. Restore code blocks (with HTML-escaped content)
  codeBlocks.forEach((code, i) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    result = result.replace(`%%CODEBLOCK_${i}%%`, `<pre>${escaped}</pre>`);
  });

  // 12. Restore table blocks (as monospace pre with HTML-escaped content)
  tableBlocks.forEach((table, i) => {
    const escaped = table.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    result = result.replace(`%%TABLE_${i}%%`, `<pre>${escaped}</pre>`);
  });

  return result;
}
