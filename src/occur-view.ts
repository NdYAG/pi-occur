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
	type Granularity,
	readTranscript,
	splitUnits,
	type TranscriptBlock,
	type TranscriptSource,
	type TranscriptUnit,
} from "./transcript.ts";

/** What the user picked: enough to find the unit again after the overlay closes. */
export interface OccurSelection {
	unit: TranscriptUnit;
	granularity: Granularity;
}

/** Options for one occur interaction. */
export interface OccurViewOptions {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	source: TranscriptSource;
	contentWidth: () => number;
	initialQuery: string;
	maxRows: () => number;
	onPreview: (selection: OccurSelection) => void;
	/** Called once; query is the input's final text so the next occur can start from it. */
	done: (selection: OccurSelection | undefined, query: string) => void;
}

/** Overlay component listing matches; up/down move, tab toggles paragraph/line units, enter jumps. */
export class OccurView implements Component, Focusable {
	private readonly options: OccurViewOptions;
	private readonly input = new Input({ prompt: "occur: " });
	private granularity: Granularity = "paragraph";
	private blocks: TranscriptBlock[] = [];
	private units: TranscriptUnit[] = [];
	private matches: OccurMatch[] = [];
	private selected = 0;
	private scroll = 0;
	private focusedState = false;

	constructor(options: OccurViewOptions) {
		this.options = options;
		this.input.setValue(options.initialQuery);
		this.input.onSubmit = () => this.confirm();
		this.input.onEscape = () => options.done(undefined, this.input.getValue());
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
		if (kb.matches(data, "tui.input.tab")) {
			this.granularity = this.granularity === "paragraph" ? "line" : "paragraph";
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
		const { theme } = this.options;
		const inner = Math.max(10, width - 2);
		const border = (text: string) => theme.fg("borderAccent", text);
		const row = (text: string) => border("│") + padTo(truncateToWidth(text, inner), inner) + border("│");

		const count =
			this.matches.length === 0
				? theme.fg("muted", this.input.getValue() ? "no matches" : "type to search")
				: theme.fg("muted", `${this.selected + 1}/${this.matches.length}`);
		const mode = theme.fg("dim", this.granularity === "paragraph" ? "paragraphs" : "lines");
		const title = ` occur · ${mode} · ${count} `;

		const lines: string[] = [];
		lines.push(frame("╭", title, "╮", inner, border));
		lines.push(row(this.input.render(inner)[0] ?? ""));
		lines.push(border("├" + "─".repeat(inner) + "┤"));

		const rows = this.listRows();
		const labelWidth = this.labelWidth();
		for (let i = 0; i < rows; i++) {
			const match = this.matches[this.scroll + i];
			if (!match) {
				if (i === 0 && this.matches.length === 0) lines.push(row(""));
				break;
			}
			lines.push(row(this.renderMatch(match, this.scroll + i === this.selected, inner, labelWidth)));
		}

		const hint = theme.fg("dim", " ↑↓ move · enter jump · tab paragraphs/lines · esc close ");
		lines.push(frame("╰", hint, "╯", inner, border));
		return lines;
	}

	invalidate(): void {
		this.input.invalidate();
	}

	private splitAll(): void {
		this.units = this.blocks.flatMap((block) => splitUnits(block, this.granularity));
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
		const match = this.matches[this.selected];
		if (match) this.options.onPreview({ unit: match.unit, granularity: this.granularity });
	}

	private confirm(): void {
		const match = this.matches[this.selected];
		this.options.done(match ? { unit: match.unit, granularity: this.granularity } : undefined, this.input.getValue());
	}

	private listRows(): number {
		return Math.max(1, this.options.maxRows() - 4);
	}

	private labelWidth(): number {
		let width = 0;
		for (const match of this.matches) width = Math.max(width, visibleWidth(blockLabel(match.unit.block)));
		return width;
	}

	private renderMatch(match: OccurMatch, selected: boolean, width: number, labelWidth: number): string {
		const { theme } = this.options;
		const marker = selected ? theme.fg("accent", "▶ ") : "  ";
		const tag = padTo(blockLabel(match.unit.block), labelWidth);
		const prefix = `${marker}${theme.fg(selected ? "accent" : "muted", tag)} `;
		const room = Math.max(1, width - visibleWidth(prefix));
		const snippet = highlight(match, room, (text) => theme.bg("searchMatchBg", theme.fg("searchMatchText", text)));
		const line = prefix + snippet;
		return selected ? theme.bold(line) : line;
	}
}

/** Shows the text around the first match so it stays visible in a narrow row, with every match highlighted. */
function highlight(match: OccurMatch, room: number, style: (text: string) => string): string {
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

	let out = start > 0 ? "…" : "";
	let cursor = start;
	for (const [from, to] of match.ranges) {
		if (to <= cursor) continue;
		out += text.slice(cursor, Math.max(cursor, from));
		out += style(text.slice(Math.max(cursor, from), to));
		cursor = to;
	}
	out += text.slice(cursor);
	return truncateToWidth(out, room);
}

/** A border line with a label, filled with rules up to the inner width. */
function frame(left: string, label: string, right: string, inner: number, border: (text: string) => string): string {
	const text = truncateToWidth(label, inner, "");
	return border(left) + text + border("─".repeat(Math.max(0, inner - visibleWidth(text)))) + border(right);
}

function padTo(text: string, width: number): string {
	const gap = width - visibleWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}
