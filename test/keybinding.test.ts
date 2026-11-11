import { strict as expect } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isKeyId, readCopyKeys, readOpenKeys } from "../src/keybinding.ts";

describe("readOpenKeys", () => {
	let dir = "";
	const write = (text: string) => writeFileSync(join(dir, "keybindings.json"), text);

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-occur-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("defaults to alt+o without a file or without occur.open", () => {
		expect.deepEqual(readOpenKeys(dir), { kind: "default", keys: ["alt+o"] });
		write(JSON.stringify({ "app.session.new": "ctrl+n" }));
		expect.deepEqual(readOpenKeys(dir), { kind: "default", keys: ["alt+o"] });
	});

	it("reads one key, a list, or none, with a byte order mark", () => {
		write(`\ufeff${JSON.stringify({ "occur.open": "ctrl+alt+o" })}`);
		expect.deepEqual(readOpenKeys(dir), { kind: "configured", keys: ["ctrl+alt+o"] });
		write(JSON.stringify({ "occur.open": ["alt+o", "f6"] }));
		expect.deepEqual(readOpenKeys(dir), { kind: "configured", keys: ["alt+o", "f6"] });
		write(JSON.stringify({ "occur.open": [] }));
		expect.deepEqual(readOpenKeys(dir), { kind: "configured", keys: [] });
	});

	it("falls back to the default and says why for a malformed value or file", () => {
		write(JSON.stringify({ "occur.open": 3 }));
		expect.equal(readOpenKeys(dir).kind, "invalid");
		write(JSON.stringify({ "occur.open": "alt+m o" }));
		expect.deepEqual(readOpenKeys(dir), { kind: "invalid", keys: ["alt+o"], reason: '"alt+m o" is not a key' });
		write("{ not json");
		expect.equal(readOpenKeys(dir).kind, "invalid");
	});
});

describe("isKeyId", () => {
	it("accepts pi's key syntax and rejects anything else", () => {
		for (const key of ["a", "alt+o", "ctrl+shift+f", "f12", "pageUp", "ctrl++", "super+/"]) {
			expect.equal(isKeyId(key), true, key);
		}
		for (const key of ["", "Alt+o", "alt+alt+o", "meta+o", "alt+m o", "ctrl+", "f13"]) {
			expect.equal(isKeyId(key), false, key);
		}
	});
});

describe("readCopyKeys", () => {
	it("defaults to alt+w, super+c and ctrl+shift+c, and reads occur.copy", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-occur-"));
		try {
			expect.deepEqual(readCopyKeys(dir), { kind: "default", keys: ["alt+w", "super+c", "ctrl+shift+c"] });
			writeFileSync(join(dir, "keybindings.json"), JSON.stringify({ "occur.copy": "alt+y" }));
			expect.deepEqual(readCopyKeys(dir), { kind: "configured", keys: ["alt+y"] });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
