import { strict as expect } from "node:assert";
import { describe, it } from "node:test";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Container, type TUI } from "@earendil-works/pi-tui";
import { OccurView, type OccurViewOptions } from "../src/occur-view.ts";

// Styling is irrelevant to these tests: every theme call returns its text unchanged.
const plainTheme = new Proxy({}, { get: () => (_token: string, text?: string) => text ?? _token }) as unknown as Theme;

// Only the keys the tests press; enough of KeybindingsManager for the view.
const keys: Record<string, string> = { "tui.select.down": "\x1b[B", "tui.select.up": "\x1b[A" };
const keybindings = {
	matches: (data: string, id: string) => keys[id] === data,
	getKeys: () => [],
} as unknown as KeybindingsManager;

function view(chatLines: string[], overrides: Partial<OccurViewOptions> = {}): OccurView {
	const chat = new Container();
	for (const line of chatLines) chat.addChild({ render: () => [line], invalidate() {} });
	return new OccurView({
		tui: { requestRender() {} } as unknown as TUI,
		theme: plainTheme,
		keybindings,
		source: { preamble: [], chat },
		contentWidth: () => 60,
		initial: { query: "", granularity: "paragraph", scope: "all" },
		maxRows: () => 8,
		onPreview: () => {},
		done: () => {},
		...overrides,
	});
}

describe("OccurView", () => {
	it("renders the same height whatever the match count", () => {
		const v = view([" alpha", " beta", " alpha again"]);
		const heights = ["alpha", "beta", "nothing", ""].map((query) => {
			for (const ch of query) v.handleInput(ch);
			const height = v.render(60).length;
			for (let i = 0; i < query.length; i++) v.handleInput("\x7f");
			return height;
		});
		expect.deepEqual(heights, [8, 8, 8, 8]);
	});

	it("puts the cursor after a prefilled query, so typing appends", () => {
		let finalQuery = "";
		const v = view([" foobar"], {
			initial: { query: "foo", granularity: "paragraph", scope: "all" },
			done: (_selection, state) => {
				finalQuery = state.query;
			},
		});
		v.handleInput("b");
		v.handleInput("\r");
		expect.equal(finalQuery, "foob");
	});
});
