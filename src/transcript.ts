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
import { type Component, Container, Spacer, stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";

export type BlockKind = "user" | "assistant" | "tool" | "bash" | "custom" | "compaction" | "branch" | "skill" | "info";

/** One chat component and its rendered lines, without terminal styling. */
export interface TranscriptBlock {
	component: Component;
	kind: BlockKind;
	/** 1-based message number; undefined for non-message blocks such as notices. */
	messageNo: number | undefined;
	/** Row of the block's first line in the transcript scroll view. */
	startRow: number;
	lines: string[];
}

/** How a block is cut into searchable units. */
export type Granularity = "paragraph" | "line";

/** One searchable piece of a block: a paragraph (soft-wrapped lines joined) or a single rendered line. */
export interface TranscriptUnit {
	block: TranscriptBlock;
	/** Position among the block's units at this granularity; with the component it identifies the unit across re-reads. */
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
			lines: rendered.map((line) => stripTerminalSequences(line).trimEnd()),
		});
	}
	return blocks;
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

/** Cuts a block into units. Paragraphs are runs of non-blank lines; wrapped lines are joined into one text. */
export function splitUnits(block: TranscriptBlock, granularity: Granularity): TranscriptUnit[] {
	return splitLines(block.lines, granularity).map((piece, index) => ({
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

/** Cuts plain (unstyled) lines into units; used both for indexing and for re-finding a unit while highlighting. */
export function splitLines(lines: readonly string[], granularity: Granularity): UnitPiece[] {
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
		if (!current || granularity === "line") {
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

/** Finds the current row of a unit after the transcript may have changed (streaming output, resize). */
export function locateUnit(
	blocks: TranscriptBlock[],
	component: Component,
	index: number,
	granularity: Granularity,
): number | undefined {
	const block = blocks.find((candidate) => candidate.component === component);
	if (!block) return undefined;
	const units = splitUnits(block, granularity);
	return (units[index] ?? units.at(-1))?.row ?? block.startRow;
}
