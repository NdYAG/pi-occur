// pi-occur: Emacs-style occur for pi's transcript. `/occur [query]` or alt+o lists matching paragraphs; enter jumps.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import { OccurView, type OccurSelection } from "./occur-view.ts";
import { blockLabel, findTranscript, locateUnit, readTranscript, type TranscriptSource } from "./transcript.ts";

// Rows of context kept above the target when jumping, so the match is not glued to the top edge.
const CONTEXT_ROWS = 1;

/** Registers the `/occur` command and its shortcut. */
export default function occur(pi: ExtensionAPI): void {
	let lastQuery = "";

	const run = async (query: string | undefined, ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("occur needs interactive mode", "error");
			return;
		}
		const contentWidth = (tui: TUI) => {
			// The transcript ScrollView reserves one column when its scrollbar is always shown.
			const columns = Math.max(1, tui.terminal.columns);
			return pi.getSettings().fullscreenScrollbar === "always" && columns > 1 ? columns - 1 : columns;
		};

		let screen: TuiAltScreen | undefined;
		let source: TranscriptSource | undefined;
		let origin: { top: number; following: boolean } | undefined;

		const selection = await ctx.ui.custom<OccurSelection | undefined>(
			(tui, theme, keybindings, done) => {
				source = findTranscript(tui);
				if (!source) {
					ctx.ui.notify("occur: unsupported pi layout (expected pi 1.5 transcript containers)", "error");
					done(undefined);
					return { render: () => [], invalidate: () => {} };
				}
				// `tui` is pi's renderer proxy; its getPrototypeOf trap forwards to the live renderer, so instanceof works.
				screen = tui instanceof TuiAltScreen ? tui : undefined;
				if (screen) origin = { top: screen.viewportTop, following: screen.isFollowingOutput };
				return new OccurView({
					tui,
					theme,
					keybindings,
					source,
					contentWidth: () => contentWidth(tui),
					initialQuery: query ?? lastQuery,
					maxRows: () => Math.max(6, Math.floor(tui.terminal.rows * 0.45)),
					onPreview: (picked) => {
						if (screen) scrollToRow(screen, picked.unit.row);
					},
					done: (picked, finalQuery) => {
						lastQuery = finalQuery;
						done(picked);
					},
				});
			},
			{ overlay: true, overlayOptions: { anchor: "bottom-center", width: "100%" } },
		);

		if (!source) return;
		if (!screen) {
			if (selection) ctx.ui.notify(`occur: ${blockLabel(selection.unit.block)}; jumping needs tuiMode "fullscreen"`, "info");
			return;
		}
		if (!selection) {
			if (origin?.following) screen.scrollToBottom();
			else if (origin) scrollTo(screen, origin.top);
			return;
		}
		// Output may have streamed in or the terminal resized while the list was open; re-read before jumping.
		const blocks = readTranscript(source, contentWidth(screen));
		const row = locateUnit(blocks, selection.unit.block.component, selection.unit.index, selection.granularity);
		scrollToRow(screen, row ?? selection.unit.row);
		screen.flash(`occur: ${blockLabel(selection.unit.block)}`);
	};

	pi.registerCommand("occur", {
		description: "List transcript paragraphs matching a query and jump to one",
		handler: async (args, ctx) => run(args.trim() || undefined, ctx),
	});

	pi.registerShortcut("alt+o", {
		description: "Occur: search the transcript",
		handler: async (ctx) => run(undefined, ctx),
	});
}

function scrollToRow(screen: TuiAltScreen, row: number): void {
	scrollTo(screen, Math.max(0, row - CONTEXT_ROWS));
}

// TuiAltScreen has no absolute scrollTo; top-then-relative is exact because scrollBy counts from row 0 after it.
function scrollTo(screen: TuiAltScreen, top: number): void {
	screen.scrollToTop();
	if (top > 0) screen.scrollBy(top);
}
