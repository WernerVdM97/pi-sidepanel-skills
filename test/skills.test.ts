/**
 * pi-sidepanel-skills unit tests
 *
 * Tests skill tracking, deduplication, explicit/auto-triggered
 * classification, available-skill backfill, and frontmatter parsing.
 *
 * Run: node --test test/skills.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Types ─────────────────────────────────────────────────────────────────

interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation: boolean;
}

interface FetchedSkill {
	name: string;
	fetchedAt: number;
	count: number;
	description?: string;
	explicit: boolean;
}

// ── Skills tracker (extracted from index.ts) ─────────────────────────────

class SkillsTracker {
	private skills: FetchedSkill[] = [];
	private skillMap = new Map<string, FetchedSkill>();
	private availableSkills = new Map<string, Skill>();
	hasData = false;

	reset(): void {
		this.skills = [];
		this.skillMap.clear();
		this.availableSkills.clear();
		this.hasData = false;
	}

	setAvailableSkills(skills: Skill[]): void {
		this.availableSkills.clear();
		for (const s of skills) {
			this.availableSkills.set(s.name, s);
		}
		// Backfill descriptions
		for (const f of this.skills) {
			if (!f.description) {
				const meta = this.availableSkills.get(f.name);
				if (meta) f.description = meta.description;
			}
		}
	}

	addFetchedSkill(name: string, explicit: boolean): void {
		const existing = this.skillMap.get(name);
		if (existing) {
			existing.count++;
			existing.explicit = existing.explicit || explicit;
		} else {
			const meta = this.availableSkills.get(name);
			const entry: FetchedSkill = {
				name,
				fetchedAt: Date.now(),
				count: 1,
				description: meta?.description,
				explicit,
			};
			this.skillMap.set(name, entry);
			this.skills.push(entry);
		}
		this.hasData = true;
	}

	getAll(): FetchedSkill[] {
		return [...this.skills];
	}

	get(name: string): FetchedSkill | undefined {
		return this.skillMap.get(name);
	}

	get size(): number {
		return this.skills.length;
	}
}

// ── Frontmatter parser (extracted from index.ts) ─────────────────────────

function extractFrontmatter(content: string): Record<string, string> {
	const result: Record<string, string> = {};

	const start = content.indexOf("---");
	if (start !== 0) return result;

	const end = content.indexOf("---", start + 3);
	if (end < 0) return result;

	const fm = content.slice(start + 3, end);

	const lines = fm.split("\n");
	let currentKey = "";
	let currentValue = "";

	for (const line of lines) {
		const keyMatch = /^(\w+):\s*(.*)/.exec(line);
		if (keyMatch) {
			if (currentKey) {
				result[currentKey] = currentValue.trim();
			}
			currentKey = keyMatch[1]!;
			const val = keyMatch[2]!.trim();
			if (val === ">" || val === "|") {
				currentValue = "";
			} else {
				currentValue = val;
				result[currentKey] = val;
				currentKey = "";
			}
		} else if (currentKey) {
			const trimmed = line.trim();
			if (trimmed) {
				currentValue += (currentValue ? " " : "") + trimmed;
			}
		}
	}

	if (currentKey) {
		result[currentKey] = currentValue.trim();
	}

	return result;
}

// ══════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════

describe("SkillsTracker", () => {
	it("starts empty", () => {
		const tracker = new SkillsTracker();
		assert.equal(tracker.size, 0);
		assert.equal(tracker.hasData, false);
	});

	it("addFetchedSkill adds new entry", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("caveman", true);

		assert.equal(tracker.size, 1);
		assert.equal(tracker.hasData, true);

		const skill = tracker.get("caveman")!;
		assert.equal(skill.name, "caveman");
		assert.equal(skill.count, 1);
		assert.equal(skill.explicit, true);
	});

	it("explicit flag persists on re-add", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("api-design", true);
		tracker.addFetchedSkill("api-design", false);

		const skill = tracker.get("api-design")!;
		assert.equal(skill.count, 2);
		assert.equal(skill.explicit, true); // once explicit, stays explicit
	});

	it("auto-triggered skills stay non-explicit", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("caveman", false);
		tracker.addFetchedSkill("caveman", false);

		const skill = tracker.get("caveman")!;
		assert.equal(skill.count, 2);
		assert.equal(skill.explicit, false);
	});

	it("explicit trumps auto-triggered", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("debug", false);   // auto-triggered first
		tracker.addFetchedSkill("debug", true);     // then explicit

		const skill = tracker.get("debug")!;
		assert.equal(skill.count, 2);
		assert.equal(skill.explicit, true); // should upgrade
	});

	it("deduplicates by name", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("test", true);
		tracker.addFetchedSkill("test", true);
		tracker.addFetchedSkill("test", false);

		assert.equal(tracker.size, 1);
		assert.equal(tracker.get("test")!.count, 3);
	});

	it("multiple different skills", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("a", true);
		tracker.addFetchedSkill("b", false);
		tracker.addFetchedSkill("c", true);

		assert.equal(tracker.size, 3);
		assert.equal(tracker.get("a")!.explicit, true);
		assert.equal(tracker.get("b")!.explicit, false);
		assert.equal(tracker.get("c")!.explicit, true);
	});

	it("reset clears everything", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("x", true);
		tracker.setAvailableSkills([{ name: "x", description: "desc", filePath: "", baseDir: "", disableModelInvocation: false }]);
		tracker.reset();

		assert.equal(tracker.size, 0);
		assert.equal(tracker.hasData, false);
	});

	it("preserves insertion order", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("z", true);
		tracker.addFetchedSkill("a", false);
		tracker.addFetchedSkill("m", true);

		const names = tracker.getAll().map((s) => s.name);
		assert.deepEqual(names, ["z", "a", "m"]);
	});
});

describe("availableSkills backfill", () => {
	it("setAvailableSkills backfills descriptions on existing skills", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("caveman", true);
		assert.equal(tracker.get("caveman")!.description, undefined);

		tracker.setAvailableSkills([
			{ name: "caveman", description: "Ultra-compressed mode", filePath: "", baseDir: "", disableModelInvocation: false },
		]);

		assert.equal(tracker.get("caveman")!.description, "Ultra-compressed mode");
	});

	it("setAvailableSkills does not overwrite existing descriptions", () => {
		const tracker = new SkillsTracker();
		tracker.setAvailableSkills([
			{ name: "api-design", description: "Original description", filePath: "", baseDir: "", disableModelInvocation: false },
		]);
		tracker.addFetchedSkill("api-design", true);
		assert.equal(tracker.get("api-design")!.description, "Original description");

		// Re-set with different description
		tracker.setAvailableSkills([
			{ name: "api-design", description: "New description", filePath: "", baseDir: "", disableModelInvocation: false },
		]);
		// Description was already set when skill was first added, so backfill
		// won't overwrite (it only fills undefined descriptions)
		assert.equal(tracker.get("api-design")!.description, "Original description");
	});

	it("setAvailableSkills handles multiple skills", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("a", true);
		tracker.addFetchedSkill("b", false);
		tracker.addFetchedSkill("c", true);

		tracker.setAvailableSkills([
			{ name: "a", description: "Skill A", filePath: "", baseDir: "", disableModelInvocation: false },
			{ name: "b", description: "Skill B", filePath: "", baseDir: "", disableModelInvocation: false },
			{ name: "c", description: "Skill C", filePath: "", baseDir: "", disableModelInvocation: false },
		]);

		assert.equal(tracker.get("a")!.description, "Skill A");
		assert.equal(tracker.get("b")!.description, "Skill B");
		assert.equal(tracker.get("c")!.description, "Skill C");
	});

	it("setAvailableSkills with extra skills doesn't affect tracker", () => {
		const tracker = new SkillsTracker();
		tracker.addFetchedSkill("existing", true);

		tracker.setAvailableSkills([
			{ name: "existing", description: "desc", filePath: "", baseDir: "", disableModelInvocation: false },
			{ name: "unknown", description: "ghost", filePath: "", baseDir: "", disableModelInvocation: false },
		]);

		assert.equal(tracker.size, 1); // unknown skill not added to tracker
		assert.equal(tracker.get("existing")!.description, "desc");
		assert.equal(tracker.get("unknown"), undefined);
	});
});

describe("extractFrontmatter", () => {
	it("parses simple key-value", () => {
		const md = `---
name: caveman
description: Ultra-compressed mode
---`;

		const result = extractFrontmatter(md);
		assert.equal(result.name, "caveman");
		assert.equal(result.description, "Ultra-compressed mode");
	});

	it("handles folded scalar (>)", () => {
		const md = `---
name: caveman
description: >
  Ultra-compressed communication mode.
  Cuts token usage ~75% by speaking like caveman.
---`;

		const result = extractFrontmatter(md);
		assert.equal(result.name, "caveman");
		assert.ok(result.description!.includes("Ultra-compressed"));
		assert.ok(result.description!.includes("~75%"));
	});

	it("handles block scalar (|)", () => {
		const md = `---
name: example
description: |
  Line one.
  Line two.
---`;

		const result = extractFrontmatter(md);
		assert.equal(result.name, "example");
		assert.ok(result.description!.includes("Line one."));
		assert.ok(result.description!.includes("Line two."));
	});

	it("returns empty object for missing frontmatter", () => {
		const md = `# No frontmatter here\n\nJust content.`;

		const result = extractFrontmatter(md);
		assert.deepEqual(result, {});
	});

	it("returns empty object for no closing delimiter", () => {
		const md = `---
name: broken
# no closing marker`;

		const result = extractFrontmatter(md);
		assert.deepEqual(result, {});
	});

	it("handles multiple keys with folded scalar", () => {
		const md = `---
name: test
version: "0.1.0"
description: >
  A longer description that spans
  multiple lines in the YAML file.
disableModelInvocation: false
---`;

		const result = extractFrontmatter(md);
		assert.equal(result.name, "test");
		assert.equal(result.version, '"0.1.0"'); // parser preserves raw YAML quotes
		assert.ok(result.description!.includes("multiple lines"));
		assert.equal(result.disableModelInvocation, "false");
	});

	it("ignores content after closing delimiter", () => {
		const md = `---
name: test
description: just a test
---
# Real content starts here
This should not be in the result.`;

		const result = extractFrontmatter(md);
		assert.equal(result.name, "test");
		assert.equal(result.description, "just a test");
		assert.equal(Object.keys(result).length, 2);
	});

	it("handles empty frontmatter block", () => {
		const md = `---
---
content`;

		const result = extractFrontmatter(md);
		assert.deepEqual(result, {});
	});

	it("ignores frontmatter not at start of file", () => {
		const md = `Some text
---
name: hidden
description: not found
---
content`;

		const result = extractFrontmatter(md);
		assert.deepEqual(result, {});
	});
});
