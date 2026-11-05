// The occur overlay: a query input over a list of matching paragraphs, labelled by message number and kind.

import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { findMatches, type OccurMatch } from "./match.ts";
import {
	blockLabel,
	readTranscript,
	type Scope,
	splitUnits,
	type TranscriptBlock,
	type TranscriptSource,
	type TranscriptUnit,
} from "./transcript.ts";

/** The view's state worth keeping between interactions. */
export interface OccurState {
	query: string;
	scope: Scope;
}

/** What the user picked: enough to find the unit again after the overlay closes, and the query to mark in it. */
export interface OccurSelection extends OccurState {
	unit: TranscriptUnit;
}

/** Options for one occur interaction. */
export interface OccurViewOptions {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	source: TranscriptSource;
	contentWidth: () => number;
	initial: OccurState;
	/** Total rows the overlay renders, frame included; the list is padded to fill them. */
	maxRows: () => number;
	/** Called when the selected match changes; undefined when nothing matches. */
	onPreview: (selection: OccurSelection | undefined) => void;
	/** Called once, with the final state so the next occur can start from it. */
	done: (selection: OccurSelection | undefined, state: OccurState) => void;
}

const SCOPE_LABEL: Record<Scope, string> = { conversation: "conversation", all: "all messages" };

// The top rule, the input and the bottom rule surround the list.
const FRAME_ROWS = 3;

/**
 * Overlay component listing matching paragraphs. up/down move, the tool-expand key (ctrl+o) toggles the scope
 * between the conversation and all messages, enter jumps.
 */
export class OccurView implements Component, Focusable {
	private readonly options: OccurViewOptions;
	private readonly input = new Input({ prompt: "Occur: " });
	private scope: Scope;
	private blocks: TranscriptBlock[] = [];
	private units: TranscriptUnit[] = [];
	private matches: OccurMatch[] = [];
	private selected = 0;
	private scroll = 0;
	private focusedState = false;

	constructor(options: OccurViewOptions) {
		this.options = options;
		this.scope = options.initial.scope;
		// setValue leaves the cursor at 0; a bracketed paste inserts the text and leaves the cursor after it.
		if (options.initial.query) this.input.handleInput(`\x1b[200~${options.initial.query}\x1b[201~`);
		this.input.onSubmit = () => this.confirm();
		this.input.onEscape = () => options.done(undefined, this.state());
		this.blocks = readTranscript(options.source, options.contentWidth());
		this.splitAll();
		this.refilter("latest");
	}

	get focused(): boolean {
		return this.focusedState;
	}

	// The Input draws the cursor, so focus must reach it for IME placement.
	set focused(value: boolean) {
		this.focusedState = value;
		this.input.focused = value;
	}

	handleInput(data: string): void {
		const kb = this.options.keybindings;
		if (kb.matches(data, "tui.select.up")) return this.move(-1);
		if (kb.matches(data, "tui.select.down")) return this.move(1);
		if (kb.matches(data, "tui.select.pageUp")) return this.move(-this.listRows());
		if (kb.matches(data, "tui.select.pageDown")) return this.move(this.listRows());
		// pi's "show more" key: tool output there, every message kind here.
		if (kb.matches(data, "app.tools.expand")) {
			this.scope = this.scope === "conversation" ? "all" : "conversation";
			this.splitAll();
			this.refilter("keep");
			return;
		}
		const before = this.input.getValue();
		this.input.handleInput(data);
		if (this.input.getValue() !== before) this.refilter("latest");
		this.options.tui.requestRender();
	}

	render(width: number): string[] {
		const { theme, keybindings: kb } = this.options;
		const rule = (label: string) =>
			theme.fg("borderAccent", truncateToWidth(`${label ? `── ${label} ` : ""}${"─".repeat(width)}`, width, ""));
		const lines = [rule(this.statusLabel()), truncateToWidth(this.input.render(width)[0] ?? "", width, "")];

		// Blank rows keep the height fixed, so the window does not move as the match count changes.
		const rows = this.listRows();
		const labelWidth = this.labelWidth();
		for (let i = 0; i < rows; i++) {
			const match = this.matches[this.scroll + i];
			lines.push(match ? this.renderMatch(match, this.scroll + i === this.selected, width, labelWidth) : "");
		}

		const scopeKey = kb.getKeys("app.tools.expand")[0];
		// "key (name: value)" names what the key controls, since the scope shows nowhere else.
		const hints: string[] = [];
		if (scopeKey) hints.push(`${scopeKey} (scope: ${SCOPE_LABEL[this.scope]})`);
		hints.push("esc (back)");
		lines.push(rule(theme.fg("dim", hints.join(" · "))));
		return lines;
	}

	private statusLabel(): string {
		if (!this.input.getValue()) return "occur";
		if (this.matches.length === 0) return this.options.theme.fg("warning", "no matches");
		return `${this.selected + 1}/${this.matches.length} matches`;
	}

	invalidate(): void {
		this.input.invalidate();
	}

	private splitAll(): void {
		this.units = this.blocks.flatMap((block) => splitUnits(block, this.scope));
	}

	/** "latest" selects the newest match (recent output is the usual target); "keep" stays near the old position. */
	private refilter(selection: "latest" | "keep"): void {
		const previous = this.matches[this.selected]?.unit;
		this.matches = findMatches(this.units, this.input.getValue());
		const at = selection === "keep" && previous ? this.matches.findIndex((match) => match.unit.row >= previous.row) : -1;
		this.selected = at >= 0 ? at : Math.max(0, this.matches.length - 1);
		this.scroll = 0;
		this.clampScroll();
		this.preview();
		this.options.tui.requestRender();
	}

	private move(delta: number): void {
		if (this.matches.length === 0) return;
		this.selected = Math.max(0, Math.min(this.matches.length - 1, this.selected + delta));
		this.clampScroll();
		this.preview();
		this.options.tui.requestRender();
	}

	private clampScroll(): void {
		const rows = this.listRows();
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + rows) this.scroll = this.selected - rows + 1;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.matches.length - rows)));
	}

	private preview(): void {
		this.options.onPreview(this.selection());
	}

	private confirm(): void {
		this.options.done(this.selection(), this.state());
	}

	private state(): OccurState {
		return { query: this.input.getValue(), scope: this.scope };
	}

	private selection(): OccurSelection | undefined {
		const match = this.matches[this.selected];
		return match && { ...this.state(), unit: match.unit };
	}

	private listRows(): number {
		return Math.max(1, this.options.maxRows() - FRAME_ROWS);
	}

	private labelWidth(): number {
		let width = 0;
		for (const match of this.matches) width = Math.max(width, visibleWidth(blockLabel(match.unit.block)));
		return width;
	}

	private renderMatch(match: OccurMatch, selected: boolean, width: number, labelWidth: number): string {
		const { theme } = this.options;
		// A match's style ends with a background reset, so the selected row's background goes on each plain piece.
		const plain = (text: string) => (selected ? theme.bg("selectedBg", text) : text);
		const marker = selected ? theme.fg("accent", "▶ ") : "  ";
		const tag = padTo(blockLabel(match.unit.block), labelWidth);
		const prefix = plain(`${marker}${theme.fg(selected ? "accent" : "muted", tag)} `);
		const room = Math.max(1, width - visibleWidth(prefix));
		const matchStyle = (text: string) => theme.bg("searchMatchBg", theme.fg("searchMatchText", text));
		// searchMatchBg falls back to selectedBg, which would hide matches on the selected row; invert them there,
		// as pi's own search does for its current match.
		const marked = selected ? (text: string) => theme.inverse(theme.bold(matchStyle(text))) : matchStyle;
		const snippet = highlight(match, room, plain, marked);
		return prefix + snippet + plain(" ".repeat(Math.max(0, room - visibleWidth(snippet))));
	}
}

/** Shows the text around the first match so it stays visible in a narrow row, with every match highlighted. */
function highlight(
	match: OccurMatch,
	room: number,
	plain: (text: string) => string,
	marked: (text: string) => string,
): string {
	const { text } = match.unit;
	const [firstStart] = match.ranges[0]!;
	// Keep about a third of the row as leading context before the first match.
	let start = 0;
	if (visibleWidth(text.slice(0, firstStart)) > Math.floor(room / 3)) {
		start = firstStart;
		let context = 0;
		while (start > 0 && context < Math.floor(room / 3)) {
			start -= 1;
			context += visibleWidth(text[start]!);
		}
	}

	let out = start > 0 ? plain("…") : "";
	let cursor = start;
	for (const [from, to] of match.ranges) {
		if (to <= cursor) continue;
		out += plain(text.slice(cursor, Math.max(cursor, from)));
		out += marked(text.slice(Math.max(cursor, from), to));
		cursor = to;
	}
	out += plain(text.slice(cursor));
	return truncateToWidth(out, room, plain("…"));
}

function padTo(text: string, width: number): string {
	const gap = width - visibleWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}
