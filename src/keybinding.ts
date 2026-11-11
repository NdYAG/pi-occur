// Reads occur's own keybinding id from pi's keybindings.json, which accepts extension ids alongside pi's own.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Key, type KeyId } from "@earendil-works/pi-tui";

/** The id users bind in keybindings.json, as pi's own actions are named. */
export const OPEN_KEYBINDING = "occur.open";

/** The key when keybindings.json does not mention occur.open. */
export const DEFAULT_OPEN_KEYS: KeyId[] = ["alt+o"];

/** The id that binds the keys copying the selected message. pi's own app.message.copy always works too. */
export const COPY_KEYBINDING = "occur.copy";

/** alt+w is Emacs' copy; super+c (cmd+c) and ctrl+shift+c reach occur only from terminals that send them (kitty protocol). */
export const DEFAULT_COPY_KEYS: KeyId[] = ["alt+w", "super+c", "ctrl+shift+c"];

/** The keys bound to an id, and why they are what they are. */
export type OpenKeys =
	| { kind: "default"; keys: KeyId[] }
	| { kind: "configured"; keys: KeyId[] }
	| { kind: "invalid"; keys: KeyId[]; reason: string };

/**
 * Keys bound to occur.open in `<agentDir>/keybindings.json`. pi gives extensions no keybindings reader at load
 * time, so this parses the file the way pi does: one key, or a list of keys; `[]` binds none. The file is user
 * input, the trust boundary here: a missing file or id means the default, a malformed one is reported.
 */
export function readOpenKeys(agentDir: string): OpenKeys {
	return readKeys(agentDir, OPEN_KEYBINDING, DEFAULT_OPEN_KEYS);
}

/** Keys bound to occur.copy; same rules as readOpenKeys. */
export function readCopyKeys(agentDir: string): OpenKeys {
	return readKeys(agentDir, COPY_KEYBINDING, DEFAULT_COPY_KEYS);
}

function readKeys(agentDir: string, id: string, defaults: KeyId[]): OpenKeys {
	let text: string;
	try {
		text = readFileSync(join(agentDir, "keybindings.json"), "utf8");
	} catch {
		return { kind: "default", keys: defaults };
	}
	let config: unknown;
	try {
		config = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch {
		return { kind: "invalid", keys: defaults, reason: "keybindings.json is not valid JSON" };
	}
	if (typeof config !== "object" || config === null || !(id in config)) {
		return { kind: "default", keys: defaults };
	}
	const value: unknown = (config as Record<string, unknown>)[id];
	const keys = typeof value === "string" ? [value] : value;
	if (!Array.isArray(keys) || !keys.every((key): key is string => typeof key === "string")) {
		const reason = `"${id}" must be a key or a list of keys, such as "alt+o" or ["alt+o"]`;
		return { kind: "invalid", keys: defaults, reason };
	}
	const bad = keys.find((key) => !isKeyId(key));
	if (bad !== undefined) return { kind: "invalid", keys: defaults, reason: `"${bad}" is not a key` };
	return { kind: "configured", keys: keys as KeyId[] };
}

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);
// Key holds the named keys as strings and modifier helpers as functions; only the strings are key names.
const BASE_KEYS = new Set<string>();
for (const value of Object.values(Key)) if (typeof value === "string") BASE_KEYS.add(value);

/** pi's key syntax (its KeyIdSchema, not exported): distinct modifiers, then a letter, digit or named key. */
export function isKeyId(key: string): boolean {
	const parts = key.split("+");
	// "+" is itself a base key, so "ctrl++" splits into ["ctrl", "", ""].
	const base = parts.at(-1) === "" && parts.at(-2) === "" ? "+" : parts.at(-1)!;
	const modifiers = base === "+" ? parts.slice(0, -2) : parts.slice(0, -1);
	if (new Set(modifiers).size !== modifiers.length || !modifiers.every((part) => MODIFIERS.has(part))) return false;
	return /^[a-z0-9]$/.test(base) || BASE_KEYS.has(base);
}
