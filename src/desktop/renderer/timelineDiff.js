export function renderSelectedHistoryDiff(entry, previousEntry) {
  const lines = buildLineDiff(previousEntry?.content || "", entry.content || "");
  return lines.length > 0 ? lines : [{ prefix: " ", text: "No text differences." }];
}

export function createDiffLine(line) {
  const element = document.createElement("span");
  element.className =
    line.prefix === "+"
      ? "diff-line diff-added"
      : line.prefix === "-"
        ? "diff-line diff-removed"
        : "diff-line diff-context";
  element.textContent = `${line.prefix} ${line.text}`;
  return element;
}

function buildLineDiff(previousContent, selectedContent) {
  const previousLines = splitDiffLines(previousContent);
  const selectedLines = splitDiffLines(selectedContent);
  if (previousContent === selectedContent) {
    return [];
  }

  if (previousLines.length * selectedLines.length > 250_000) {
    return [
      { prefix: "-", text: `${previousLines.length} previous snapshot lines` },
      { prefix: "+", text: `${selectedLines.length} selected snapshot lines` }
    ];
  }

  const table = Array.from({ length: previousLines.length + 1 }, () => new Array(selectedLines.length + 1).fill(0));
  for (let leftIndex = previousLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = selectedLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] =
        previousLines[leftIndex] === selectedLines[rightIndex]
          ? table[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }

  const diff = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < previousLines.length && rightIndex < selectedLines.length) {
    if (previousLines[leftIndex] === selectedLines[rightIndex]) {
      diff.push({ prefix: " ", text: previousLines[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      diff.push({ prefix: "-", text: previousLines[leftIndex] });
      leftIndex += 1;
    } else {
      diff.push({ prefix: "+", text: selectedLines[rightIndex] });
      rightIndex += 1;
    }
  }

  while (leftIndex < previousLines.length) {
    diff.push({ prefix: "-", text: previousLines[leftIndex] });
    leftIndex += 1;
  }

  while (rightIndex < selectedLines.length) {
    diff.push({ prefix: "+", text: selectedLines[rightIndex] });
    rightIndex += 1;
  }

  return diff;
}

function splitDiffLines(value) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.length === 0 ? [] : normalized.split("\n");
}
