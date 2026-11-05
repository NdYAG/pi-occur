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
	const units: TranscriptUnit[] = [];
	let runStart = -1;
	const flush = (end: number): void => {
		if (runStart < 0) return;
		const lines = block.lines.slice(runStart, end);
		units.push({ block, index: units.length, row: block.startRow + runStart, text: joinWrapped(lines) });
		runStart = -1;
	};

	for (let i = 0; i < block.lines.length; i++) {
		const blank = block.lines[i]!.trim() === "";
		if (granularity === "line") {
			if (!blank) units.push({ block, index: units.length, row: block.startRow + i, text: block.lines[i]!.trim() });
			continue;
		}
		if (blank) flush(i);
		else if (runStart < 0) runStart = i;
	}
	flush(block.lines.length);
	return units;
}

/** Joins soft-wrapped lines. Wide (CJK) text wraps without spaces, so no space is inserted between wide characters. */
function joinWrapped(lines: string[]): string {
	let text = "";
	for (const raw of lines) {
		const line = raw.trim();
		if (!text) {
			text = line;
			continue;
		}
		const last = Array.from(text.slice(-2)).at(-1) ?? "";
		const first = Array.from(line.slice(0, 2))[0] ?? "";
		text += visibleWidth(last) === 2 && visibleWidth(first) === 2 ? line : ` ${line}`;
	}
	return text;
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
