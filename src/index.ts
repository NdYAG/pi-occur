// pi-occur: Emacs-style occur for pi's transcript. `/occur [query]` or the occur.open key (alt+o by default) lists
// matching paragraphs; enter jumps.
// By default it searches the conversation: user messages and assistant replies, without thinking or tool output.

import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { isKeyRelease, type Keybinding, type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import { type HighlightTarget, TranscriptHighlight } from "./highlight.ts";
import { OPEN_KEYBINDING, readOpenKeys } from "./keybinding.ts";
import { type OccurSelection, type OccurState, OccurView } from "./occur-view.ts";
import {
	blockLabel,
	findTranscript,
	locateUnit,
	readTranscript,
	type TranscriptSource,
	transcriptHeight,
	revealTop,
	type UnitExtent,
	unitExtent,
} from "./transcript.ts";

// The overlay has a fixed height so it does not jump while typing: 12 list rows, at most 40% of the screen.
// A small window leaves most of the transcript visible for the preview; pageUp/pageDown page through the rest.
const LIST_ROWS = 12;
const MAX_SCREEN_SHARE = 0.4;

/** Registers the `/occur` command and its shortcut. */
export default function occur(pi: ExtensionAPI): void {
	// The last query and scope; the next occur starts from them.
	let last: OccurState = { query: "", scope: "conversation" };
	// The mark left after a jump; cleared by the next key, the next occur, or shutdown.
	let lingering: { highlight: TranscriptHighlight; stopListening: () => void } | undefined;
	const clearLingering = (): void => {
		lingering?.stopListening();
		lingering?.highlight.set(undefined);
		lingering = undefined;
	};

	const run = async (query: string | undefined, ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("occur needs interactive mode", "error");
			return;
		}
		clearLingering();
		const contentWidth = (tui: TUI) => {
			// The transcript ScrollView reserves one column when its scrollbar is always shown.
			const columns = Math.max(1, tui.terminal.columns);
			return pi.getSettings().fullscreenScrollbar === "always" && columns > 1 ? columns - 1 : columns;
		};

		let tuiRef: TUI | undefined;
		let keys: KeybindingsManager | undefined;
		let screen: TuiAltScreen | undefined;
		let source: TranscriptSource | undefined;
		let highlight: TranscriptHighlight | undefined;
		let origin: { top: number; following: boolean } | undefined;

		const selection = await ctx.ui.custom<OccurSelection | undefined>(
			(tui, theme, keybindings, done) => {
				source = findTranscript(tui);
				if (!source) {
					ctx.ui.notify("occur: unsupported pi layout (expected pi 1.5 transcript containers)", "error");
					done(undefined);
					return { render: () => [], invalidate: () => {} };
				}
				tuiRef = tui;
				keys = keybindings;
				// `tui` is pi's renderer proxy; its getPrototypeOf trap forwards to the live renderer, so instanceof works.
				screen = tui instanceof TuiAltScreen ? tui : undefined;
				if (screen) origin = { top: screen.viewportTop, following: screen.isFollowingOutput };
				const mark = new TranscriptHighlight(highlightStyle(theme), () => tui.requestRender());
				highlight = mark;
				return new OccurView({
					tui,
					theme,
					keybindings,
					source,
					contentWidth: () => contentWidth(tui),
					initial: { ...last, query: query ?? last.query },
					maxRows: () => overlayRows(tui),
					onPreview: (picked) => {
						mark.set(picked && toTarget(picked));
						if (!picked || !screen || !source) return;
						// The overlay covers the bottom of the screen, so less of the transcript shows while it is open.
						const height = transcriptHeight(source, contentWidth(tui));
						const visible = Math.min(viewportHeight(screen, height), tui.terminal.rows - overlayRows(tui));
						reveal(screen, unitExtent(picked.unit, picked.query), visible);
					},
					done: (picked, state) => {
						last = state;
						done(picked);
					},
				});
			},
			// The view sizes itself from the live terminal on every render, so no maxHeight that could cut its frame.
			{ overlay: true, overlayOptions: { anchor: "bottom-center", width: "100%" } },
		);

		if (!source || !highlight || !tuiRef || !keys) return;
		if (!selection) {
			highlight.set(undefined);
			if (origin?.following) screen?.scrollToBottom();
			else if (origin && screen) scrollTo(screen, origin.top);
			return;
		}

		highlight.set(toTarget(selection));
		lingering = { highlight, stopListening: clearOnNextKey(tuiRef, keys, clearLingering) };
		const label = blockLabel(selection.unit.block);
		if (!screen) {
			ctx.ui.notify(`occur: ${label}; jumping needs tuiMode "fullscreen"`, "info");
			return;
		}
		// Output may have streamed in or the terminal resized while the list was open; re-read before jumping.
		const width = contentWidth(screen);
		const { unit, scope, query: picked } = selection;
		const current = locateUnit(readTranscript(source, width), unit.block.component, unit.index, scope) ?? unit;
		reveal(screen, unitExtent(current, picked), viewportHeight(screen, transcriptHeight(source, width)));
		screen.flash(`occur: ${label}`);
	};

	pi.registerCommand("occur", {
		description: "List transcript paragraphs matching a query and jump to one",
		handler: async (args, ctx) => run(args.trim() || undefined, ctx),
	});

	// Read at load, as pi reads its own bindings; `/reload` picks up an edited keybindings.json.
	const open = readOpenKeys(getAgentDir());
	for (const key of open.keys) {
		pi.registerShortcut(key, {
			description: "Occur: search the transcript",
			handler: async (ctx) => run(undefined, ctx),
		});
	}
	if (open.kind === "invalid") {
		// Notifications need a UI, which does not exist while extensions load.
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`occur: ${open.reason}; using ${open.keys.join(", ")} (${OPEN_KEYBINDING})`, "warning");
		});
	}

	pi.on("session_shutdown", async () => clearLingering());
}

/** Total overlay height: two rules and the input (3 rows) plus the list, capped by the screen share; at least one list row. */
function overlayRows(tui: TUI): number {
	return Math.max(4, Math.min(LIST_ROWS + 3, Math.floor(tui.terminal.rows * MAX_SCREEN_SHARE)));
}

function toTarget(selection: OccurSelection): HighlightTarget {
	const { unit, scope, query } = selection;
	return { component: unit.block.component, kind: unit.block.kind, index: unit.index, scope, query };
}

function highlightStyle(theme: Theme) {
	return { gutter: theme.fg("accent", "▌"), match: (text: string) => theme.inverse(text) };
}

// Mouse reports (wheel, clicks) arrive as SGR sequences; scrolling to read the match must not clear it.
const SGR_MOUSE = /^\x1b\[<\d+;\d+;\d+[Mm]$/;

// Transcript scrolling keeps the mark for the same reason.
const SCROLL_KEYS: Keybinding[] = [
	"tui.altScreen.pageUp",
	"tui.altScreen.pageDown",
	"tui.altScreen.halfPageUp",
	"tui.altScreen.halfPageDown",
	"tui.altScreen.lineUp",
	"tui.altScreen.lineDown",
	"tui.altScreen.top",
	"tui.altScreen.bottom",
];

/** Calls clear on the next key that is not scrolling, letting the key through; returns a function that stops listening. */
function clearOnNextKey(tui: TUI, keybindings: KeybindingsManager, clear: () => void): () => void {
	return tui.addInputListener((data) => {
		if (SGR_MOUSE.test(data) || isKeyRelease(data)) return undefined;
		if (SCROLL_KEYS.some((key) => keybindings.matches(data, key))) return undefined;
		clear();
		return undefined;
	});
}

function reveal(screen: TuiAltScreen, extent: UnitExtent, visibleRows: number): void {
	scrollTo(screen, revealTop(extent, visibleRows));
}

/**
 * The transcript viewport height, which pi does not expose: the scroll view stops at contentHeight - viewport,
 * so scrolling to the bottom and reading the top gives it. A transcript shorter than the viewport cannot scroll;
 * its own height is returned, which is enough to decide whether a unit fits.
 */
function viewportHeight(screen: TuiAltScreen, contentHeight: number): number {
	screen.scrollToBottom();
	return contentHeight - screen.viewportTop;
}

// TuiAltScreen has no absolute scrollTo; top-then-relative is exact because scrollBy counts from row 0 after it.
function scrollTo(screen: TuiAltScreen, top: number): void {
	screen.scrollToTop();
	if (top > 0) screen.scrollBy(top);
}
