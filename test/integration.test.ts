/**
 * pi-sidepanel-skills integration tests
 *
 * Loads the REAL extension entry point (index.ts) against the FakePi
 * harness, covering registration, the sidepanel:ready recovery
 * handshake, and the busy lifecycle around session replay.
 *
 * Run: node --test test/integration.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import {
	FakePi,
	captureBusy,
	captureRegistrations,
	sessionCtx,
} from "./_harness/fake-pi.ts";

register("./_harness/stub-hooks.mjs", import.meta.url);
const extension = (await import("../index.ts")).default;

describe("registration", () => {
	it("registers the skills tab on session_start", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);

		await pi.fire("session_start", {}, sessionCtx());
		assert.equal(regs.length, 1);
		assert.equal(regs[0].id, "skills");
		assert.equal(regs[0].label, "Skills");
	});

	it("re-registers on sidepanel:ready (load-order recovery)", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);

		await pi.fire("session_start", {}, sessionCtx());
		pi.events.emit("sidepanel:ready", {});
		assert.equal(regs.length, 2, "ready must trigger a fresh registration");
		assert.equal(regs[1].id, "skills");
	});

	it("flags busy with a message during replay, then clears", async () => {
		const pi = new FakePi();
		const busy = captureBusy(pi);
		extension(pi as any);

		await pi.fire("session_start", {}, sessionCtx());
		assert.equal(busy.length, 2);
		assert.equal(busy[0].busy, true);
		assert.equal(busy[0].message, "replaying session…");
		assert.equal(busy[1].busy, false);
	});

	it("renders through the registered component without a theme", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);

		await pi.fire("session_start", {}, sessionCtx());
		const lines: string[] = regs[0].component.render(50, 12);
		assert.ok(Array.isArray(lines) && lines.length > 0);
	});
});
