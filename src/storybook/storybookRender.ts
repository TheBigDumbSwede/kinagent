import type { StorybookChapter, StorybookDocument } from "./storybook.js";

export function renderStorybookHtml(book: StorybookDocument): string {
  const chapterNav = book.chapters
    .map(
      (chapter, index) =>
        `<li><a href="#${escapeAttribute(chapter.chapterId)}">${index + 1}. ${escapeHtml(chapter.chapterTitle)}</a></li>`
    )
    .join("\n");
  const chapters = book.chapters.map(renderChapter).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(book.title)}</title>
  <style>
    @page {
      size: Letter;
      margin: 0;
    }
    :root {
      color: #24221f;
      background: #fbfaf6;
      font-family: "Georgia", "Times New Roman", serif;
    }
    html {
      min-height: 100%;
      background: #fbfaf6;
    }
    body {
      margin: 0;
      background: #fbfaf6;
      line-height: 1.55;
      font-size: 12.5pt;
    }
    .book {
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
      box-sizing: border-box;
      min-height: 100vh;
      padding: 0.72in;
    }
    .cover {
      min-height: calc(100vh - 1.44in);
      display: flex;
      flex-direction: column;
      justify-content: center;
      border-bottom: 1px solid #c9c2b8;
      break-after: page;
    }
    h1 {
      font-size: 34pt;
      line-height: 1.05;
      margin: 0 0 0.08in;
      font-weight: 600;
    }
    .subtitle {
      font-size: 15pt;
      color: #55504a;
      margin: 0;
    }
    .toc, article {
      break-before: page;
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
    .chapter-body p {
      margin: 0 0 0.15in;
      overflow-wrap: anywhere;
      break-inside: avoid;
      orphans: 3;
      widows: 3;
    }
    .chapter-body p + p {
      text-indent: 0.18in;
    }
  </style>
</head>
<body>
  <main class="book">
    <section class="cover">
      <h1>${escapeHtml(book.title)}</h1>
      <p class="subtitle">${escapeHtml(book.subtitle)}</p>
    </section>
    <section class="toc">
      <h2>Contents</h2>
      <ol>${chapterNav}</ol>
    </section>
    ${chapters}
  </main>
</body>
</html>`;
}

function renderChapter(chapter: StorybookChapter): string {
  return `<article id="${escapeAttribute(chapter.chapterId)}">
  <h2>${escapeHtml(chapter.chapterTitle)}</h2>
  <div class="chapter-body">${renderParagraphs(chapter.body)}</div>
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
