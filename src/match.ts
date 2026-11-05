// Matches a query against transcript units: smart-case literal substring, like Emacs occur's default.

import type { TranscriptUnit } from "./transcript.ts";

/** A unit that contains the query, with the match ranges in its text. */
export interface OccurMatch {
	unit: TranscriptUnit;
	/** [start, end) code-unit offsets into unit.text. */
	ranges: Array<[number, number]>;
}

/** Returns matching units in transcript order. Case-insensitive unless the query has an uppercase letter. */
export function findMatches(units: TranscriptUnit[], query: string): OccurMatch[] {
	if (!query) return [];
	const caseSensitive = query !== query.toLowerCase();
	const needle = caseSensitive ? query : query.toLowerCase();
	const matches: OccurMatch[] = [];
	for (const unit of units) {
		const haystack = caseSensitive ? unit.text : unit.text.toLowerCase();
		const ranges: Array<[number, number]> = [];
		let from = 0;
		for (;;) {
			const at = haystack.indexOf(needle, from);
			if (at < 0) break;
			ranges.push([at, at + needle.length]);
			from = at + needle.length;
		}
		if (ranges.length > 0) matches.push({ unit, ranges });
	}
	return matches;
}
