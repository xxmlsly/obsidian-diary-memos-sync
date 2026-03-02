import type { MemosSyncSettings } from "./settings";

/**
 * Format a date to a string using a simple pattern
 * Supported tokens: YYYY, MM, DD, HH, mm, ss
 */
export function formatDate(date: Date, pattern: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
  };

  let result = pattern;
  // Replace longest tokens first to avoid partial matches
  for (const [token, value] of Object.entries(tokens)) {
    result = result.replace(new RegExp(token, "g"), value);
  }
  return result;
}

/**
 * Get the daily note file path for a given date
 */
export function getDailyNotePath(
  date: Date,
  settings: MemosSyncSettings
): string {
  const folder = settings.dailyNotesFolder.replace(/^\/+|\/+$/g, "");
  const fileName = formatDate(date, settings.fileNameFormat);
  if (folder) {
    return `${folder}/${fileName}.md`;
  }
  return `${fileName}.md`;
}

/**
 * UID marker prefix used to identify memo blocks in the note
 */
const MEMO_UID_PREFIX = '<span class="memo-uid" data-uid="';
const MEMO_UID_SUFFIX = '"></span>';
// Also support legacy formats for parsing old notes
const LEGACY_PREFIXES = ["%% memo-uid:", "<!-- memo-uid:"];
const LEGACY_SUFFIXES = [" %%", " -->"];

/**
 * Build a uid marker comment for embedding in a memo block
 */
export function buildUidMarker(uid: string): string {
  return `${MEMO_UID_PREFIX}${uid}${MEMO_UID_SUFFIX}`;
}

/**
 * Extract uid from a line containing a uid marker, or return null
 */
export function extractUidFromLine(line: string): string | null {
  // Try current format: <span class="memo-uid" data-uid="UID"></span>
  const idx = line.indexOf(MEMO_UID_PREFIX);
  if (idx !== -1) {
    const start = idx + MEMO_UID_PREFIX.length;
    const end = line.indexOf(MEMO_UID_SUFFIX, start);
    if (end !== -1) return line.substring(start, end).trim();
  }
  // Try legacy formats: %% memo-uid:UID %% and <!-- memo-uid:UID -->
  for (let i = 0; i < LEGACY_PREFIXES.length; i++) {
    const legIdx = line.indexOf(LEGACY_PREFIXES[i]);
    if (legIdx !== -1) {
      const legStart = legIdx + LEGACY_PREFIXES[i].length;
      const legEnd = line.indexOf(LEGACY_SUFFIXES[i], legStart);
      if (legEnd !== -1) return line.substring(legStart, legEnd).trim();
    }
  }
  return null;
}

/**
 * Format a single memo using the configured template.
 * Automatically appends a hidden uid marker for smart merge.
 */
export function formatMemo(
  memo: { uid: string; content: string; displayTime: string; tags: string[] },
  settings: MemosSyncSettings
): string {
  const displayDate = new Date(memo.displayTime);
  const timeStr = formatDate(displayDate, settings.dateTimeFormat);
  const tagsStr = memo.tags
    .map((t) => `${settings.tagPrefix}${t}`)
    .join(" ");

  // Process memo content - handle multi-line
  const content = memo.content.trim();

  let result = settings.memoTemplate;
  result = result.replace(/\{\{time\}\}/g, timeStr);
  result = result.replace(/\{\{content\}\}/g, content);
  result = result.replace(/\{\{tags\}\}/g, tagsStr);
  result = result.replace(/\{\{uid\}\}/g, memo.uid);

  // Prepend uid marker as an invisible inline <span> at the start of the first line's content
  // e.g. "- <span ...></span>⏰ 12:51 | ..." — invisible in Obsidian reading/preview mode
  const uidMarker = buildUidMarker(memo.uid);
  const lines = result.split("\n");
  // Insert the span right after the list marker (e.g. "- " or "* ")
  const listMatch = lines[0].match(/^(\s*[-*+]\s)/);
  if (listMatch) {
    lines[0] = listMatch[1] + uidMarker + lines[0].slice(listMatch[1].length);
  } else {
    lines[0] = uidMarker + lines[0];
  }

  // For multi-line memo content, indent continuation lines (2nd line onwards)
  // so that parseSectionBlocks can correctly identify them as part of this memo block.
  // Use 2-space indent to align with list item content.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() !== "" && !lines[i].startsWith("  ") && !lines[i].startsWith("\t")) {
      lines[i] = "  " + lines[i];
    }
  }

  result = lines.join("\n");

  return result;
}

/**
 * Represents a parsed block inside the memos section.
 * A block is either a memo (identified by uid) or manual content.
 */
interface SectionBlock {
  type: "memo" | "manual";
  uid?: string; // only for type === "memo"
  lines: string[];
}

/**
 * Check if a line is a standalone legacy uid marker line
 * (e.g. "%% memo-uid:xxx %%" or "<!-- memo-uid:xxx -->")
 */
function isStandaloneUidMarkerLine(line: string): string | null {
  const trimmed = line.trim();
  // Check %% format
  if (trimmed.startsWith("%% memo-uid:") && trimmed.endsWith(" %%")) {
    return trimmed.slice("%% memo-uid:".length, -" %%".length).trim();
  }
  // Check <!-- --> format
  if (trimmed.startsWith("<!-- memo-uid:") && trimmed.endsWith("-->")) {
    let inner = trimmed.slice("<!-- memo-uid:".length, -"-->".length).trim();
    // Remove trailing space or dash that might appear
    inner = inner.replace(/[\s-]+$/, "");
    return inner || null;
  }
  return null;
}

/**
 * Parse the existing memos section content (lines between heading and next heading)
 * into memo blocks and manual content blocks.
 *
 * Supports three uid formats:
 * 1. New inline span: - <span class="memo-uid" data-uid="UID"></span>content
 * 2. Legacy inline HTML: - content <!-- memo-uid:UID -->
 * 3. Legacy separate line: - content\n%% memo-uid:UID %%  (or <!-- -->)
 *
 * Strategy: two-pass approach.
 * Pass 1: identify uid markers (both inline and standalone) and map them to content lines.
 * Pass 2: walk through lines, grouping them into memo and manual blocks.
 */
export function parseSectionBlocks(sectionLines: string[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];

  // Pass 1: Build a map of line index → uid for lines that start a memo block
  // Also track standalone uid marker lines so we can absorb them
  const memoStartUid = new Map<number, string>(); // lineIndex → uid
  const uidMarkerLineIndices = new Set<number>();  // standalone uid marker lines

  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];

    // Check for inline uid (new span format or legacy inline HTML comment)
    const inlineUid = extractUidFromLine(line);
    if (inlineUid) {
      // Check if this is a standalone uid marker line (not a content line)
      const standaloneUid = isStandaloneUidMarkerLine(line);
      if (standaloneUid) {
        // This is a standalone uid marker — find the content line above it
        uidMarkerLineIndices.add(i);
        // Walk backwards to find the nearest non-blank content line
        let contentIdx = i - 1;
        while (contentIdx >= 0 && sectionLines[contentIdx].trim() === "") {
          contentIdx--;
        }
        if (contentIdx >= 0 && !memoStartUid.has(contentIdx) && !uidMarkerLineIndices.has(contentIdx)) {
          memoStartUid.set(contentIdx, standaloneUid);
        }
      } else {
        // Inline uid on a content line — this line starts the memo
        memoStartUid.set(i, inlineUid);
      }
    }
  }

  // Pass 2: Walk through lines, building blocks
  let currentBlock: SectionBlock | null = null;

  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];

    if (memoStartUid.has(i)) {
      // This line starts a new memo block
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: "memo", uid: memoStartUid.get(i)!, lines: [line] };
    } else if (uidMarkerLineIndices.has(i)) {
      // Standalone uid marker line — absorb into current memo block
      if (currentBlock && currentBlock.type === "memo") {
        currentBlock.lines.push(line);
      }
      // If not in a memo block, just skip (orphan marker)
    } else if (currentBlock && currentBlock.type === "memo") {
      // Check if this line continues the current memo block:
      // - indented lines (multi-line memo content)
      // - empty lines within a memo block
      const isContinuation =
        line.startsWith("  ") ||
        line.startsWith("\t") ||
        line.trim() === "";

      if (isContinuation) {
        currentBlock.lines.push(line);
      } else {
        // Non-indented, non-empty line without uid → manual content
        blocks.push(currentBlock);
        currentBlock = { type: "manual", lines: [line] };
      }
    } else {
      // Manual content or continuation of manual block
      if (!currentBlock || currentBlock.type !== "manual") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "manual", lines: [line] };
      } else {
        currentBlock.lines.push(line);
      }
    }
  }

  if (currentBlock) blocks.push(currentBlock);

  return blocks;
}

/**
 * Build the full memos section content
 */
export function buildMemosSection(
  memos: { uid: string; content: string; displayTime: string; tags: string[] }[],
  settings: MemosSyncSettings
): string {
  const heading = settings.memosHeading;
  const items = memos.map((m) => formatMemo(m, settings));

  const lines = [heading, "", ...items, ""];
  return lines.join("\n");
}

/**
 * Merge memos section into existing note content using smart merge.
 *
 * Smart merge logic:
 * 1. Parse existing memos section to identify memo blocks (by uid) and manual content blocks.
 * 2. Update existing memo blocks with new content from API.
 * 3. Append new memos that don't exist yet.
 * 4. Preserve all manual (non-memo) content in its original position.
 *
 * Returns updated content.
 */
export function mergeMemosIntoNote(
  existingContent: string,
  memosSection: string,
  settings: MemosSyncSettings
): string {
  const heading = settings.memosHeading.trim();
  const headingLevel = (heading.match(/^#+/) || ["##"])[0];

  // Check if the memos section already exists
  const headingRegex = new RegExp(
    `^${escapeRegExp(heading)}\\s*$`,
    "m"
  );

  if (headingRegex.test(existingContent)) {
    // Smart merge: parse existing section and merge with new memos
    const lines = existingContent.split("\n");
    let sectionStart = -1;
    let sectionEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
      if (headingRegex.test(lines[i].trim())) {
        sectionStart = i;
        continue;
      }
      if (sectionStart >= 0 && i > sectionStart) {
        // Check if this line is a heading of same or higher level
        const match = lines[i].match(/^(#+)\s/);
        if (match && match[1].length <= headingLevel.length) {
          sectionEnd = i;
          break;
        }
      }
    }

    if (sectionStart >= 0) {
      const before = lines.slice(0, sectionStart);
      const after = lines.slice(sectionEnd);

      // Extract existing section body (lines between heading and next heading)
      // Skip the heading line itself and any immediately following blank lines
      let bodyStart = sectionStart + 1;
      while (bodyStart < sectionEnd && lines[bodyStart].trim() === "") {
        bodyStart++;
      }
      const existingSectionBody = lines.slice(bodyStart, sectionEnd);

      // Parse new memos from the API-generated section
      const newMemosLines = memosSection.split("\n");
      // Skip heading and blank lines in the new section
      let newBodyStart = 0;
      for (let i = 0; i < newMemosLines.length; i++) {
        if (headingRegex.test(newMemosLines[i].trim())) {
          newBodyStart = i + 1;
          break;
        }
      }
      while (
        newBodyStart < newMemosLines.length &&
        newMemosLines[newBodyStart].trim() === ""
      ) {
        newBodyStart++;
      }
      // Trim trailing empty lines from new memos body
      let newBodyEnd = newMemosLines.length;
      while (newBodyEnd > newBodyStart && newMemosLines[newBodyEnd - 1].trim() === "") {
        newBodyEnd--;
      }
      const newMemosBody = newMemosLines.slice(newBodyStart, newBodyEnd);

      // Parse both sections into blocks
      const existingBlocks = parseSectionBlocks(existingSectionBody);
      const newBlocks = parseSectionBlocks(newMemosBody);

      // Debug: log parsed blocks
      console.debug(`Memos Sync: [merge] existingSectionBody lines: ${existingSectionBody.length}`);
      for (const b of existingBlocks) {
        console.debug(`Memos Sync: [merge] existing block: type=${b.type}, uid=${b.uid || 'N/A'}, lines=${b.lines.length}, firstLine="${b.lines[0]?.substring(0, 80)}"`);
      }
      console.debug(`Memos Sync: [merge] newMemosBody lines: ${newMemosBody.length}`);
      for (const b of newBlocks) {
        console.debug(`Memos Sync: [merge] new block: type=${b.type}, uid=${b.uid || 'N/A'}, lines=${b.lines.length}, firstLine="${b.lines[0]?.substring(0, 80)}"`);
      }

      // Build maps for quick lookup
      const newMemoMap = new Map<string, SectionBlock>();
      const newMemoOrder: string[] = []; // uid list in API time order
      for (const block of newBlocks) {
        if (block.type === "memo" && block.uid) {
          newMemoMap.set(block.uid, block);
          newMemoOrder.push(block.uid);
        }
      }

      // Collect existing memo uids and manual blocks with their positions
      const existingMemoUids = new Set<string>();
      for (const block of existingBlocks) {
        if (block.type === "memo" && block.uid) {
          existingMemoUids.add(block.uid);
        }
      }

      // Find new memos that need to be inserted (not in existing section)
      const newUids = newMemoOrder.filter((uid) => !existingMemoUids.has(uid));

      console.debug(`Memos Sync: [merge] existingMemoUids: [${[...existingMemoUids].join(', ')}]`);
      console.debug(`Memos Sync: [merge] newMemoOrder (from API): [${newMemoOrder.join(', ')}]`);
      console.debug(`Memos Sync: [merge] newUids (to insert): [${newUids.join(', ')}]`);

      // Build a position map: for each new uid, find where it should be inserted
      // based on the API order. A new memo should be placed right before the next
      // existing memo that comes after it in API order, or at the end if none.
      const insertBeforeMap = new Map<string, string[]>(); // existingUid -> [newUids to insert before it]
      const appendAtEnd: string[] = []; // new uids to append at the very end

      for (const newUid of newUids) {
        const newIdx = newMemoOrder.indexOf(newUid);
        let placed = false;
        // Look for the next memo in API order that already exists
        for (let j = newIdx + 1; j < newMemoOrder.length; j++) {
          const nextUid = newMemoOrder[j];
          if (existingMemoUids.has(nextUid)) {
            if (!insertBeforeMap.has(nextUid)) {
              insertBeforeMap.set(nextUid, []);
            }
            insertBeforeMap.get(nextUid)!.push(newUid);
            placed = true;
            break;
          }
        }
        if (!placed) {
          // No existing memo comes after this one — look for the previous existing memo
          // and insert after it; if none found, append at end
          appendAtEnd.push(newUid);
        }
      }

      // Rebuild the section:
      // - Update existing memos with API content
      // - Remove memos deleted from API (uid not in newMemoMap)
      // - Insert new memos at correct time-ordered positions
      // - Preserve manual content in its original position
      const mergedLines: string[] = [];

      for (const block of existingBlocks) {
        if (block.type === "memo" && block.uid) {
          // Insert any new memos that should appear before this one
          const toInsertBefore = insertBeforeMap.get(block.uid);
          if (toInsertBefore) {
            for (const uid of toInsertBefore) {
              const newBlock = newMemoMap.get(uid);
              if (newBlock) mergedLines.push(...newBlock.lines);
            }
          }

          if (newMemoMap.has(block.uid)) {
            // Memo still exists in API — replace with updated content
            const updated = newMemoMap.get(block.uid)!;
            // Trim trailing blank lines before comparing to avoid false positives
            // (existing block may contain trailing blank lines from note parsing)
            const oldTrimmedLines = block.lines.slice();
            while (oldTrimmedLines.length > 0 && oldTrimmedLines[oldTrimmedLines.length - 1].trim() === "") {
              oldTrimmedLines.pop();
            }
            const newTrimmedLines = updated.lines.slice();
            while (newTrimmedLines.length > 0 && newTrimmedLines[newTrimmedLines.length - 1].trim() === "") {
              newTrimmedLines.pop();
            }
            const oldContent = oldTrimmedLines.join('\n');
            const newContent = newTrimmedLines.join('\n');
            if (oldContent !== newContent) {
              console.debug(`Memos Sync: [merge] UPDATING memo uid=${block.uid}`);
              console.debug(`Memos Sync: [merge]   OLD: "${oldContent.substring(0, 100)}"`);
              console.debug(`Memos Sync: [merge]   NEW: "${newContent.substring(0, 100)}"`);
            } else {
              console.debug(`Memos Sync: [merge] memo uid=${block.uid} unchanged`);
            }
            mergedLines.push(...updated.lines);
          }
          // else: memo no longer returned by API — delete it (skip)
        } else {
          // Manual content — always preserve
          mergedLines.push(...block.lines);
        }
      }

      // Append new memos that belong at the end (after all existing memos)
      for (const uid of appendAtEnd) {
        const newBlock = newMemoMap.get(uid);
        if (newBlock) mergedLines.push(...newBlock.lines);
      }

      // Trim trailing blank lines from merged content
      while (mergedLines.length > 0 && mergedLines[mergedLines.length - 1].trim() === "") {
        mergedLines.pop();
      }

      const newContent = [
        ...before,
        heading,
        "",
        ...mergedLines,
        "",
        ...after,
      ]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");
      return newContent;
    }
  }

  // Memos section doesn't exist yet, insert it
  if (!existingContent.trim()) {
    return memosSection;
  }

  if (settings.insertPosition === "top") {
    return memosSection + "\n" + existingContent;
  } else {
    const trimmed = existingContent.replace(/\n+$/, "");
    return trimmed + "\n\n" + memosSection;
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
