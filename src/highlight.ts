// Marks the selected occur unit inside the transcript itself, by wrapping one component's render.

import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { findRanges } from "./match.ts";
import {
	type BlockKind,
	type LineSpan,
	plainLines,
	type Scope,
	searchableLines,
	splitLines,
	thinkingRanges,
} from "./transcript.ts";

/** Which unit to mark, and the query whose matches inside it are emphasised. */
export interface HighlightTarget {
	component: Component;
	kind: BlockKind;
	index: number;
	scope: Scope;
	query: string;
}

/** Styles applied to the marked unit; plain functions so this file needs no theme. */
export interface HighlightStyle {
	/** Gutter marker drawn in column 0 of each line of the unit. */
	gutter: string;
	/** Wraps one run of matched text that has no escape sequences inside. */
	match: (text: string) => string;
}

/** Owns at most one wrapped component; setting a new target unwraps the previous one. */
export class TranscriptHighlight {
	private readonly style: HighlightStyle;
	private readonly requestRender: () => void;
	private wrapped: { component: Component; own: PropertyDescriptor | undefined } | undefined;

	constructor(style: HighlightStyle, requestRender: () => void) {
		this.style = style;
		this.requestRender = requestRender;
	}

	/** Marks a unit, or clears the mark with undefined. */
	set(target: HighlightTarget | undefined): void {
		this.unwrap();
		if (target) this.wrap(target);
		this.requestRender();
	}

	private wrap(target: HighlightTarget): void {
		const component = target.component;
		// pi's components render through their prototype; an own property shadows it for this instance only.
		const own = Object.getOwnPropertyDescriptor(component, "render");
		const original = component.render;
		// Components return their cached array while unchanged, so the decoration is reused for the same array.
		let last: { input: string[]; output: string[] } | undefined;
		component.render = (width: number) => {
			const input = original.call(component, width);
			if (last?.input !== input) {
				const thinking = thinkingRanges(component, input.length, width);
				last = { input, output: decorate(input, thinking, target, this.style) };
			}
			return last.output;
		};
		this.wrapped = { component, own };
	}

	private unwrap(): void {
		if (!this.wrapped) return;
		const { component, own } = this.wrapped;
		if (own) Object.defineProperty(component, "render", own);
		else delete (component as Partial<Component>).render;
		this.wrapped = undefined;
	}
}

/** Returns new lines with the target unit marked; the component's cached array is never modified. */
export function decorate(
	lines: string[],
	thinking: Array<[number, number]>,
	target: HighlightTarget,
	style: HighlightStyle,
): string[] {
	const plain = plainLines(lines);
	// Re-split on every render, the same way the list did: streaming output or a resize moves the unit.
	const searchable = searchableLines(target.kind, plain, thinking, target.scope);
	const piece = splitLines(searchable)[target.index];
	if (!piece) return lines;

	const ranges = findRanges(piece.text, target.query);
	const out = lines.slice();
	for (const span of piece.spans) {
		const columns = rangeColumns(piece.text, span, ranges);
		out[span.line] = markLine(out[span.line]!, plain[span.line]!, columns, style);
	}
	return out;
}

/** Converts text ranges that fall on one line into [startCol, endCol) screen columns. */
function rangeColumns(text: string, span: LineSpan, ranges: Array<[number, number]>): Array<[number, number]> {
	const columns: Array<[number, number]> = [];
	for (const [from, to] of ranges) {
		const start = Math.max(from, span.textStart);
		const end = Math.min(to, span.textEnd);
		if (start >= end) continue;
		const startCol = span.col + visibleWidth(text.slice(span.textStart, start));
		columns.push([startCol, startCol + visibleWidth(text.slice(start, end))]);
	}
	return columns;
}

/**
 * Puts the gutter in column 0 when that cell is blank (pi pads messages by one column) and wraps matched
 * columns. Escape sequences pass through untouched, so background colours and links stay intact.
 */
function markLine(line: string, plain: string, columns: Array<[number, number]>, style: HighlightStyle): string {
	const gutter = plain.startsWith(" ");
	let out = "";
	// Escapes before column 0 set the line's style; the gutter's own reset would end it, so they are replayed.
	let leading = "";
	let col = 0;
	let i = 0;
	let run = "";
	let runMatched = false;
	const flush = (): void => {
		if (run) out += runMatched ? style.match(run) : run;
		run = "";
	};

	while (i < line.length) {
		const escape = escapeLength(line, i);
		if (escape > 0) {
			flush();
			out += line.slice(i, i + escape);
			if (col === 0) leading += line.slice(i, i + escape);
			i += escape;
			continue;
		}
		const char = String.fromCodePoint(line.codePointAt(i)!);
		const width = visibleWidth(char);
		if (col === 0 && gutter && char === " ") {
			flush();
			out += style.gutter + leading;
		} else {
			const matched = columns.some(([start, end]) => col >= start && col < end);
			if (matched !== runMatched) flush();
			runMatched = matched;
			run += char;
		}
		col += width;
		i += char.length;
	}
	flush();
	return out;
}

// CSI (ESC [ ... final byte) and OSC/APC (ESC ] or ESC _ ... BEL or ST), the sequences pi-tui emits.
function escapeLength(line: string, at: number): number {
	if (line.charCodeAt(at) !== 0x1b) return 0;
	const kind = line[at + 1];
	if (kind === "[") {
		for (let j = at + 2; j < line.length; j++) {
			const code = line.charCodeAt(j);
			if (code >= 0x40 && code <= 0x7e) return j + 1 - at;
		}
		return 0;
	}
	if (kind === "]" || kind === "_") {
		for (let j = at + 2; j < line.length; j++) {
			if (line.charCodeAt(j) === 0x07) return j + 1 - at;
			if (line.charCodeAt(j) === 0x1b && line[j + 1] === "\\") return j + 2 - at;
		}
		return 0;
	}
	return 0;
}
