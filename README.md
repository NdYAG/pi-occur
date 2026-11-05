<h1 align="center">pi-occur 🔍</h1>

Emacs `occur` for the [pi](https://pi.dev) transcript. Type a query and get a list of matching paragraphs labelled by message number and kind. Move through the list to preview, press enter to jump to the selected paragraph.

![pi-occur listing matches for a query, with the selected paragraph marked in the transcript](https://ndyag.github.io/pi-occur/screenshot.png)

By default it searches the conversation, the text you wrote and read: your messages and the assistant's replies, without thinking, tool calls or tool output.

```
── 2/3 matches ───────────────────────────────────────────────────────
Occur: iterm
  #2 user        …使用 iterm 进行搜索的话，会将 iterm 开启 TUI 之前…
▶ #29 assistant  …所以只能用 iTerm 的搜索。
  #305 assistant …thinking 的段落其实是 iterm 搜索结果的大头。

── ctrl+o (scope: conversation) · esc (back) ─────────────────────────
```

## Install

```sh
pi install npm:pi-occur
# or try it for one run
pi -e npm:pi-occur
# or from a local checkout
pi install ./pi-occur
```

## Use

| Action | Key |
|---|---|
| Open | `/occur [query]` or `alt+o`, the `occur.open` keybinding (reopens with the last query) |
| Move, preview | `up` / `down`, `pageUp` / `pageDown` |
| Jump | `enter` |
| Conversation or all messages | `ctrl+o` (pi's `app.tools.expand` binding) |
| Close, restore scroll position | `esc` |

### Change the key

Bind `occur.open` in pi's [`keybindings.json`](https://pi.dev/docs/keybindings) (`~/.pi/agent/keybindings.json`), like pi's own actions, then run `/reload`:

```json
{
  "occur.open": "ctrl+alt+o"
}
```

A list binds several keys, and `[]` binds none, leaving `/occur`. Without the entry the key is `alt+o`. A value pi cannot read as a key, such as `"alt+m o"` (key sequences are not supported), keeps `alt+o` and shows a warning at startup. `/hotkeys` lists the active key.

### Window

The window has a fixed height (12 result rows, at most 40% of the screen), so it does not move while you type; `pageUp` / `pageDown` page through longer lists.

The scope is remembered for the next occur, like the query.

Matching is a literal substring, case-insensitive unless the query has an uppercase letter.

The selected paragraph is marked in the transcript itself: a `▌` in the left margin of each of its lines and the matches in reverse video. The mark follows the selection while the list is open, stays after `enter` while you scroll (wheel, page and line scrolling keys), and clears on the next other key or on `esc`.

## How it works

- Searches what pi has rendered, so the text matches the screen: Markdown is rendered, and collapsed tool output is not searchable until expanded with `ctrl+o`.
- A unit is a paragraph: a run of non-blank rendered lines inside one message. Soft-wrapped lines are joined, so a query that crosses a wrap still matches. Lists, tables and code blocks have no blank lines between rows and become one paragraph. Jumping shows a paragraph from its first row when it fits on screen; a paragraph taller than the screen is shown from the row of its first match instead.
- Scopes: **conversation** searches user messages and assistant replies, including their error notices; assistant thinking is left out whether it is expanded or collapsed. **all messages** adds thinking, tool and bash executions, custom messages, skill blocks, compaction and branch summaries, and status notices.
- `#N` counts the chat components that are messages (user, assistant, each tool call, bash, custom, summaries). Notices such as status lines have no number. It does not match `/tree` entry numbering.
- Jumping needs `tuiMode: "fullscreen"` (pi's default). In regular mode the terminal owns the scrollback; the list still works and enter reports the message number.

## Compatibility

Built against pi 1.5.0. It reads pi internals that are not public API:

- the transcript is the first child of the TUI, a container holding header, loaded resources and chat;
- message kinds are recognised by `instanceof` on pi's exported message components;
- assistant thinking is found as the `MouseRegion` children of the message's single content container; if that structure does not add up, the whole message counts as reply;
- the transcript content width is the terminal width, minus one column when `fullscreenScrollbar` is `"always"`;
- `occur.open` is read from `keybindings.json` by occur itself, since pi gives extensions no keybindings reader at load time (the same approach as pi-mcp-adapter's `mcp.panel.open`); pi's keybindings schema allows extension ids;
- the mark is drawn by shadowing `render` on the one marked component instance, which relies on pi re-rendering transcript components each frame.

If the layout check fails, `/occur` reports "unsupported pi layout" instead of jumping to wrong rows.

## Develop

```bash
npm install --ignore-scripts
npm run check
npm test
```
