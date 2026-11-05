import { strict as expect } from "node:assert";
import { describe, it } from "node:test";
import { findMatches } from "../src/match.ts";
import { Container, MouseRegion, Text } from "@earendil-works/pi-tui";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import {
	type BlockKind,
	type Scope,
	splitUnits,
	type TranscriptBlock,
	thinkingRanges,
} from "../src/transcript.ts";

function block(lines: string[], startRow = 10, kind: BlockKind = "assistant", thinking: Array<[number, number]> = []): TranscriptBlock {
	return { component: { render: () => lines, invalidate() {} }, kind, messageNo: 3, startRow, lines, thinking };
}

describe("splitUnits", () => {
	it("joins soft-wrapped lines into one paragraph and keeps the first row", () => {
		const units = splitUnits(block(["", " The quick brown", " fox jumps", "", " Second para"]), "paragraph", "all");
		expect.deepEqual(
			units.map((unit) => [unit.row, unit.text]),
			[
				[11, "The quick brown fox jumps"],
				[14, "Second para"],
			],
		);
	});

	it("joins wrapped CJK text without inserting spaces", () => {
		const units = splitUnits(block(["这是一段很长的中", "文消息"]), "paragraph", "all");
		expect.equal(units[0]!.text, "这是一段很长的中文消息");
	});

	it("line mode yields one unit per non-blank line", () => {
		const units = splitUnits(block(["a", "", "b", "c"]), "line", "all");
		expect.deepEqual(
			units.map((unit) => [unit.index, unit.row, unit.text]),
			[
				[0, 10, "a"],
				[1, 12, "b"],
				[2, 13, "c"],
			],
		);
	});
});

describe("findMatches", () => {
	const units = splitUnits(block(["Foo bar foo", "", "nothing", "", "wrapped fo", "o here"]), "paragraph", "all");

	it("is case-insensitive for a lowercase query and finds every occurrence", () => {
		const matches = findMatches(units, "foo");
		expect.equal(matches.length, 1);
		expect.deepEqual(matches[0]!.ranges, [
			[0, 3],
			[8, 11],
		]);
	});

	it("is case-sensitive when the query has an uppercase letter", () => {
		expect.deepEqual(findMatches(units, "Foo")[0]!.ranges, [[0, 3]]);
	});

	it("does not match across a wrap that split a word (wrap adds a space)", () => {
		expect.equal(findMatches(units, "foo here").length, 0);
		expect.equal(findMatches(units, "fo o here").length, 1);
	});
});

describe("scope", () => {
	const texts = (kind: BlockKind, scope: Scope, thinking: Array<[number, number]> = []) =>
		splitUnits(block([" think", "", " reply"], 0, kind, thinking), "paragraph", scope).map((unit) => unit.text);

	it("conversation keeps user and assistant messages and drops other kinds", () => {
		expect.deepEqual(texts("user", "conversation"), ["think", "reply"]);
		expect.deepEqual(texts("tool", "conversation"), []);
		expect.deepEqual(texts("tool", "all"), ["think", "reply"]);
	});

	it("conversation drops thinking lines; all keeps them", () => {
		expect.deepEqual(texts("assistant", "conversation", [[0, 1]]), ["reply"]);
		expect.deepEqual(texts("assistant", "all", [[0, 1]]), ["think", "reply"]);
	});
});

describe("thinkingRanges", () => {
	it("finds the MouseRegion children of an assistant message's content container", () => {
		const message = new AssistantMessageComponent();
		const content = message.children[0] as Container;
		content.addChild(new Text("", 0, 0));
		content.addChild(new MouseRegion(new Text("thinking", 1, 0), () => undefined));
		content.addChild(new Text("reply", 1, 0));
		const lines = message.render(40);
		expect.deepEqual(thinkingRanges(message, lines.length, 40), [[0, 1]]);
	});

	it("treats nothing as thinking when the structure does not add up", () => {
		const message = new AssistantMessageComponent();
		expect.deepEqual(thinkingRanges(message, 5, 40), []);
	});
});
