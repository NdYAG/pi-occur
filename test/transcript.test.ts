import { strict as expect } from "node:assert";
import { describe, it } from "node:test";
import { findMatches } from "../src/match.ts";
import { splitUnits, type TranscriptBlock } from "../src/transcript.ts";

function block(lines: string[], startRow = 10): TranscriptBlock {
	return { component: { render: () => lines, invalidate() {} }, kind: "assistant", messageNo: 3, startRow, lines };
}

describe("splitUnits", () => {
	it("joins soft-wrapped lines into one paragraph and keeps the first row", () => {
		const units = splitUnits(block(["", " The quick brown", " fox jumps", "", " Second para"]), "paragraph");
		expect.deepEqual(
			units.map((unit) => [unit.row, unit.text]),
			[
				[11, "The quick brown fox jumps"],
				[14, "Second para"],
			],
		);
	});

	it("joins wrapped CJK text without inserting spaces", () => {
		const units = splitUnits(block(["这是一段很长的中", "文消息"]), "paragraph");
		expect.equal(units[0]!.text, "这是一段很长的中文消息");
	});

	it("line mode yields one unit per non-blank line", () => {
		const units = splitUnits(block(["a", "", "b", "c"]), "line");
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
	const units = splitUnits(block(["Foo bar foo", "", "nothing", "", "wrapped fo", "o here"]), "paragraph");

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
