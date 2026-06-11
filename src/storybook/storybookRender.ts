import type { StorybookChapter, StorybookDocument } from "./storybook.js";

export function renderStorybookHtml(book: StorybookDocument): string {
  const chapterNav = book.chapters
    .map(
      (chapter, index) =>
        `<li><a href="#${escapeAttribute(chapter.chapterId)}">${index + 1}. ${escapeHtml(chapter.chapterTitle)}</a></li>`
    )
    .join("\n");
  const chapters = book.chapters.map(renderChapter).join("\n");
  const warningList =
    book.warnings.length > 0
      ? `<section class="warnings"><h2>Generation Notes</h2><ul>${book.warnings
          .map((warning) => `<li>${escapeHtml(warning)}</li>`)
          .join("")}</ul></section>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(book.title)}</title>
  <style>
    @page { margin: 0.72in; }
    :root {
      color: #24221f;
      background: #fbfaf6;
      font-family: "Georgia", "Times New Roman", serif;
    }
    body {
      margin: 0;
      line-height: 1.55;
      font-size: 12.5pt;
    }
    .cover {
      min-height: 82vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      border-bottom: 1px solid #c9c2b8;
      page-break-after: always;
    }
    .source {
      font-family: "Segoe UI", Arial, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 9pt;
      color: #696157;
    }
    h1 {
      font-size: 34pt;
      line-height: 1.05;
      margin: 0.25in 0 0.08in;
      font-weight: 600;
    }
    .subtitle {
      font-size: 15pt;
      color: #55504a;
      margin: 0;
    }
    .meta, .provenance, .notes {
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 9.5pt;
      color: #696157;
    }
    .toc, .warnings, article {
      page-break-before: always;
    }
    h2 {
      font-size: 20pt;
      margin: 0 0 0.16in;
      font-weight: 600;
    }
    h3 {
      font-size: 15pt;
      margin: 0 0 0.14in;
    }
    a {
      color: #3d5a66;
      text-decoration: none;
    }
    p {
      margin: 0 0 0.13in;
    }
    ul {
      padding-left: 0.24in;
    }
    article {
      break-inside: avoid-page;
    }
    .chapter-body p {
      margin: 0 0 0.15in;
      overflow-wrap: anywhere;
    }
    .chapter-body p + p {
      text-indent: 0.18in;
    }
    .provenance {
      border-top: 1px solid #d8d1c7;
      padding-top: 0.1in;
      margin-top: 0.22in;
    }
  </style>
</head>
<body>
  <section class="cover">
    <div class="source">${escapeHtml(book.source.displayName)} · ${escapeHtml(book.source.scope)}</div>
    <h1>${escapeHtml(book.title)}</h1>
    <p class="subtitle">${escapeHtml(book.subtitle)}</p>
    <p class="meta">Generated ${escapeHtml(formatDate(book.generatedAt))} · ${escapeHtml(book.options.style)} · ${escapeHtml(formatOption(book.options.quoteMode))}</p>
  </section>
  <section class="toc">
    <h2>Contents</h2>
    <ol>${chapterNav}</ol>
  </section>
  ${warningList}
  ${chapters}
</body>
</html>`;
}

function renderChapter(chapter: StorybookChapter): string {
  const notes = chapter.notes.length > 0 ? `<p class="notes">${escapeHtml(chapter.notes.join(" "))}</p>` : "";
  return `<article id="${escapeAttribute(chapter.chapterId)}">
  <h2>${escapeHtml(chapter.chapterTitle)}</h2>
  <div class="chapter-body">${renderParagraphs(chapter.body)}</div>
  ${notes}
  <p class="provenance">Source scenes: ${escapeHtml(chapter.sourceSceneIds.join(", "))}</p>
</article>`;
}

function renderParagraphs(value: string): string {
  const paragraphs = paragraphBlocks(value);
  if (paragraphs.length === 0) {
    return `<p></p>`;
  }

  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n    ");
}

function paragraphBlocks(value: string): string[] {
  const explicitParagraphs = value
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/\s*\n\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);

  return explicitParagraphs.flatMap(splitLongParagraph);
}

function splitLongParagraph(paragraph: string): string[] {
  const maxParagraphLength = 520;
  if (paragraph.length <= maxParagraphLength) {
    return [paragraph];
  }

  const sentences = paragraph.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) ?? [paragraph];
  const paragraphs: string[] = [];
  let current = "";

  for (const rawSentence of sentences) {
    const sentence = rawSentence.replace(/\s+/g, " ").trim();
    if (!sentence) {
      continue;
    }

    if (current && `${current} ${sentence}`.length > maxParagraphLength) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) {
    paragraphs.push(current);
  }

  return paragraphs.length > 0 ? paragraphs : [paragraph];
}

function formatOption(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/[^a-z0-9_-]/gi, "-");
}
