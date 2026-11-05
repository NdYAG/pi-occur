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
	const matches: OccurMatch[] = [];
	for (const unit of units) {
		const ranges = findRanges(unit.text, query);
		if (ranges.length > 0) matches.push({ unit, ranges });
	}
	return matches;
}

/** Every non-overlapping occurrence of query in text, as [start, end) offsets, with smart case. */
export function findRanges(text: string, query: string): Array<[number, number]> {
	if (!query) return [];
	const caseSensitive = query !== query.toLowerCase();
	const needle = caseSensitive ? query : query.toLowerCase();
	const haystack = caseSensitive ? text : text.toLowerCase();
	const ranges: Array<[number, number]> = [];
	for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
		ranges.push([at, at + needle.length]);
	}
	return ranges;
}
