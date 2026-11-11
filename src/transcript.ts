// Reads pi's rendered transcript: which chat components are messages, where each starts, and its searchable units.

import {
	AssistantMessageComponent,
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	DynamicBorder,
	SkillInvocationMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	MouseRegion,
	Spacer,
	stripTerminalSequences,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { findRanges } from "./match.ts";

export type BlockKind = "user" | "assistant" | "tool" | "bash" | "custom" | "compaction" | "branch" | "skill" | "info";

/** Which text is searched: "conversation" is what the user wrote and read (user messages, assistant replies). */
export type Scope = "conversation" | "all";

const CONVERSATION_KINDS: ReadonlySet<BlockKind> = new Set(["user", "assistant"]);

/** One chat component and its rendered lines, without terminal styling. */
export interface TranscriptBlock {
	component: Component;
	kind: BlockKind;
	/** 1-based message number; undefined for non-message blocks such as notices. */
	messageNo: number | undefined;
	/** Row of the block's first line in the transcript scroll view. */
	startRow: number;
	lines: string[];
	/** [start, end) line ranges of assistant thinking, excluded from the conversation scope. */
	thinking: Array<[number, number]>;
}

/** One searchable piece of a block: a paragraph, its soft-wrapped lines joined. */
export interface TranscriptUnit {
	block: TranscriptBlock;
	/** Position among the block's paragraphs; with the component it identifies the unit across re-reads. */
	index: number;
	row: number;
	text: string;
	spans: LineSpan[];
}

/** The containers pi renders into the transcript scroll view. */
export interface TranscriptSource {
	/** Components rendered above the chat (header, loaded resources). */
	preamble: Component[];
	chat: Container;
}

/**
 * Finds the transcript containers in pi's component tree. pi 1.5 mounts `documentContainer` first, holding
 * header, loaded resources and chat. This is pi-internal layout, so the shape is checked here: it is the
 * trust boundary between this extension and pi's internals.
 */
export function findTranscript(tui: TUI): TranscriptSource | undefined {
	const document = tui.children[0];
	if (!(document instanceof Container) || document.children.length !== 3) return undefined;
	const [header, resources, chat] = document.children;
	if (!(chat instanceof Container) || !header || !resources) return undefined;
	return { preamble: [header, resources], chat };
}

/** Renders the transcript at the scroll view's content width and returns its blocks with their start rows. */
export function readTranscript(source: TranscriptSource, width: number): TranscriptBlock[] {
	// Components cache their rendering per width, so this mostly returns cached lines.
	let row = 0;
	for (const component of source.preamble) row += component.render(width).length;

	const blocks: TranscriptBlock[] = [];
	let messageNo = 0;
	for (const component of source.chat.children) {
		const rendered = component.render(width);
		const startRow = row;
		row += rendered.length;
		if (component instanceof Spacer || component instanceof DynamicBorder) continue;
		const kind = classify(component);
		if (kind !== "info") messageNo += 1;
		blocks.push({
			component,
			kind,
			messageNo: kind === "info" ? undefined : messageNo,
			startRow,
			lines: plainLines(rendered),
			thinking: thinkingRanges(component, rendered.length, width),
		});
	}
	return blocks;
}

/** The transcript's height in rows at a width; cheap, since components return their cached lines. */
export function transcriptHeight(source: TranscriptSource, width: number): number {
	let rows = 0;
	for (const component of [...source.preamble, ...source.chat.children]) rows += component.render(width).length;
	return rows;
}

/** Rendered lines without terminal styling or trailing padding. */
export function plainLines(rendered: readonly string[]): string[] {
	return rendered.map((line) => stripTerminalSequences(line).trimEnd());
}

/**
 * Line ranges of an assistant message's thinking blocks. pi 1.5 renders an assistant message as one content
 * container whose thinking blocks, and only those, are wrapped in a MouseRegion (click toggles them). This is
 * pi-internal structure: if the children's lines do not add up to the message, nothing is treated as thinking.
 */
export function thinkingRanges(component: Component, lineCount: number, width: number): Array<[number, number]> {
	if (!(component instanceof AssistantMessageComponent)) return [];
	const content = component.children[0];
	if (component.children.length !== 1 || !(content instanceof Container)) return [];
	const ranges: Array<[number, number]> = [];
	let line = 0;
	for (const child of content.children) {
		const count = child.render(width).length;
		if (child instanceof MouseRegion && count > 0) ranges.push([line, line + count]);
		line += count;
	}
	return line === lineCount ? ranges : [];
}

/** The lines occur searches in a block for a scope; excluded lines become blank so they split paragraphs too. */
export function searchableLines(
	kind: BlockKind,
	lines: readonly string[],
	thinking: Array<[number, number]>,
	scope: Scope,
): readonly string[] {
	if (scope === "all") return lines;
	if (!CONVERSATION_KINDS.has(kind)) return [];
	if (thinking.length === 0) return lines;
	const masked = lines.slice();
	for (const [start, end] of thinking) masked.fill("", start, end);
	return masked;
}

function classify(component: Component): BlockKind {
	if (component instanceof UserMessageComponent) return "user";
	if (component instanceof AssistantMessageComponent) return "assistant";
	if (component instanceof ToolExecutionComponent) return "tool";
	if (component instanceof BashExecutionComponent) return "bash";
	if (component instanceof CustomMessageComponent) return "custom";
	if (component instanceof CompactionSummaryMessageComponent) return "compaction";
	if (component instanceof BranchSummaryMessageComponent) return "branch";
	if (component instanceof SkillInvocationMessageComponent) return "skill";
	return "info";
}

/** "#N kind" for messages, the bare kind for notices. */
export function blockLabel(block: TranscriptBlock): string {
	return block.messageNo === undefined ? block.kind : `#${block.messageNo} ${block.kind}`;
}

/**
 * The text copied for a message: the Markdown pi was given when the component keeps it (user text, assistant
 * text blocks), else the rendered lines. Reads pi-internal fields, so each is type-checked.
 */
export function messageText(block: TranscriptBlock, scope: Scope): string {
	return rawMarkdown(block.component, scope) ?? block.lines.join("\n").replace(/^\n+|\n+$/g, "");
}

function rawMarkdown(component: Component, scope: Scope): string | undefined {
	if (component instanceof UserMessageComponent) {
		const { text } = component as unknown as { text?: unknown };
		return typeof text === "string" && text.trim() ? text.trim() : undefined;
	}
	if (component instanceof AssistantMessageComponent) {
		const { lastMessage } = component as unknown as { lastMessage?: { content?: unknown } };
		if (!Array.isArray(lastMessage?.content)) return undefined;
		const parts: string[] = [];
		for (const part of lastMessage.content as Array<Record<string, unknown>>) {
			if (part?.type === "text" && typeof part.text === "string") parts.push(part.text.trim());
			else if (scope === "all" && part?.type === "thinking" && typeof part.thinking === "string") parts.push(part.thinking.trim());
		}
		const text = parts.filter(Boolean).join("\n\n");
		return text || undefined;
	}
	return undefined;
}

/** Cuts a block into units. Paragraphs are runs of non-blank lines; wrapped lines are joined into one text. */
export function splitUnits(block: TranscriptBlock, scope: Scope): TranscriptUnit[] {
	const lines = searchableLines(block.kind, block.lines, block.thinking, scope);
	return splitLines(lines).map((piece, index) => ({
		block,
		index,
		row: block.startRow + piece.spans[0]!.line,
		text: piece.text,
		spans: piece.spans,
	}));
}

/** Where a piece of unit text sits on screen: text[textStart, textEnd) is line `line` from column `col`. */
export interface LineSpan {
	/** Line index within the block. */
	line: number;
	textStart: number;
	textEnd: number;
	col: number;
}

/** A unit's text and its placement, independent of the block's position in the transcript. */
export interface UnitPiece {
	text: string;
	spans: LineSpan[];
}

/** Cuts plain (unstyled) lines into paragraphs; used both for indexing and for re-finding a unit while highlighting. */
export function splitLines(lines: readonly string[]): UnitPiece[] {
	const pieces: UnitPiece[] = [];
	let current: UnitPiece | undefined;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		const trimmed = raw.trim();
		if (!trimmed) {
			current = undefined;
			continue;
		}
		const col = visibleWidth(raw.slice(0, raw.length - raw.trimStart().length));
		if (!current) {
			current = { text: "", spans: [] };
			pieces.push(current);
		} else if (needsSpace(current.text, trimmed)) {
			current.text += " ";
		}
		current.spans.push({ line: i, textStart: current.text.length, textEnd: current.text.length + trimmed.length, col });
		current.text += trimmed;
	}
	return pieces;
}

// Wide (CJK) text wraps without spaces, so no space is inserted between two wide characters.
function needsSpace(before: string, after: string): boolean {
	const last = Array.from(before.slice(-2)).at(-1) ?? "";
	const first = Array.from(after.slice(0, 2))[0] ?? "";
	return !(visibleWidth(last) === 2 && visibleWidth(first) === 2);
}

/** Finds a unit again after the transcript may have changed (streaming output, resize). */
export function locateUnit(
	blocks: TranscriptBlock[],
	component: Component,
	index: number,
	scope: Scope,
): TranscriptUnit | undefined {
	const block = blocks.find((candidate) => candidate.component === component);
	if (!block) return undefined;
	const units = splitUnits(block, scope);
	return units[index] ?? units.at(-1);
}

/** Rows a unit occupies, and the row holding the start of its first match, both in transcript rows. */
export interface UnitExtent {
	firstRow: number;
	lastRow: number;
	matchRow: number;
}

/** Where a unit and its first match of `query` sit; the match row is the first row when nothing matches. */
export function unitExtent(unit: TranscriptUnit, query: string): UnitExtent {
	const firstRow = unit.row;
	const rowOf = (span: LineSpan) => unit.block.startRow + span.line;
	const lastRow = rowOf(unit.spans.at(-1)!);
	const start = findRanges(unit.text, query)[0]?.[0];
	const span = start === undefined ? undefined : unit.spans.find((candidate) => start < candidate.textEnd);
	return { firstRow, lastRow, matchRow: span ? rowOf(span) : firstRow };
}

// Rows of context kept above the target, so it is not glued to the top edge.
const CONTEXT_ROWS = 1;

/**
 * The scroll top that reveals a unit: its first row when the whole unit fits in the visible rows, otherwise
 * the row of its first match, so a long code block or list still shows what was found.
 */
export function revealTop(extent: UnitExtent, visibleRows: number): number {
	const fits = extent.lastRow - extent.firstRow + 1 + CONTEXT_ROWS <= visibleRows;
	return Math.max(0, (fits ? extent.firstRow : extent.matchRow) - CONTEXT_ROWS);
}
