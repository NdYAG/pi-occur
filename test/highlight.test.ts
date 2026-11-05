import { strict as expect } from "node:assert";
import { describe, it } from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import { decorate, type HighlightStyle, TranscriptHighlight } from "../src/highlight.ts";

const style: HighlightStyle = { gutter: "|", match: (text) => `[${text}]` };

function component(lines: string[]): Component {
	return { render: () => lines, invalidate() {} };
}

describe("decorate", () => {
	it("marks the gutter of every line of the paragraph and brackets matches", () => {
		const lines = ["", " one foo", " two", "", " foo three"];
		const target = { component: component(lines), index: 0, kind: "assistant" as const, granularity: "paragraph" as const, scope: "all" as const, query: "foo" };
		expect.deepEqual(decorate(lines, [], target, style), ["", "|one [foo]", "|two", "", " foo three"]);
	});

	it("keeps escape sequences and marks a match split by a wrap on both lines", () => {
		const lines = ["\x1b[48;5;236m wrapped fo\x1b[49m", "\x1b[48;5;236m o here\x1b[49m"];
		const target = { component: component(lines), index: 0, kind: "assistant" as const, granularity: "paragraph" as const, scope: "all" as const, query: "fo o" };
		// The line's leading style is replayed after the gutter, whose own reset would end it.
		expect.deepEqual(decorate(lines, [], target, style), [
			"\x1b[48;5;236m|\x1b[48;5;236mwrapped [fo]\x1b[49m",
			"\x1b[48;5;236m|\x1b[48;5;236m[o] here\x1b[49m",
		]);
	});

	it("maps matches in wide text to their screen columns", () => {
		const lines = [" 这是中", " 文搜索"];
		const target = { component: component(lines), index: 0, kind: "assistant" as const, granularity: "paragraph" as const, scope: "all" as const, query: "中文" };
		expect.deepEqual(decorate(lines, [], target, style), ["|这是[中]", "|[文]搜索"]);
	});

	it("skips thinking lines in the conversation scope, so unit indices match the list", () => {
		const lines = ["", " thinking foo", "", " reply foo"];
		const target = { component: component(lines), kind: "assistant" as const, index: 0, granularity: "paragraph" as const, scope: "conversation" as const, query: "foo" };
		expect.deepEqual(decorate(lines, [[1, 2]], target, style), ["", " thinking foo", "", "|reply [foo]"]);
	});

	it("does not touch the component's own lines array", () => {
		const lines = [" foo"];
		const target = { component: component(lines), index: 0, kind: "assistant" as const, granularity: "line" as const, scope: "all" as const, query: "foo" };
		decorate(lines, [], target, style);
		expect.deepEqual(lines, [" foo"]);
	});
});

describe("TranscriptHighlight", () => {
	class Message implements Component {
		render(): string[] {
			return [" hello"];
		}
		invalidate(): void {}
	}

	it("wraps one instance and restores the prototype render when cleared", () => {
		const a = new Message();
		const b = new Message();
		const mark = new TranscriptHighlight(style, () => {});
		mark.set({ component: a, kind: "user", index: 0, granularity: "line", scope: "all", query: "ell" });
		expect.deepEqual(a.render(), ["|h[ell]o"]);
		expect.deepEqual(b.render(), [" hello"]);

		mark.set({ component: b, kind: "user", index: 0, granularity: "line", scope: "all", query: "h" });
		expect.equal(Object.hasOwn(a, "render"), false);
		expect.deepEqual(b.render(), ["|[h]ello"]);

		mark.set(undefined);
		expect.equal(Object.hasOwn(b, "render"), false);
	});
});
