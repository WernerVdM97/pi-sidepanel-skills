/**
 * pi-sidepanel-skills — Fetched skills tab for pi-sidepanel
 *
 * Registers a "Skills" tab that shows only skills explicitly fetched
 * in this session — not all available skills. Tracks invocations by
 * intercepting the input event for /skill:NAME patterns.
 *
 * Navigation: ↑↓ j/k scroll · PgUp/PgDn · g/G top/bottom
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

/** Word-wrap a plain string to lines no wider than maxWidth. */
function wordWrap(text: string, maxWidth: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let cur = "";
	for (const w of words) {
		if (!cur) {
			cur = w;
		} else if (cur.length + 1 + w.length <= maxWidth) {
			cur += " " + w;
		} else {
			lines.push(cur);
			cur = w;
		}
	}
	if (cur) lines.push(cur);
	return lines.length > 0 ? lines : [""];
}

// ── Types ─────────────────────────────────────────────────────────────────

/** Token estimate helpers (same heuristic as pi core). */
function est(chars: number): number {
	return Math.ceil(chars / 4);
}

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
	return String(n);
}

/** Mirrors pi's Skill type from core/skills.ts */
interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation: boolean;
}

interface FetchedSkill {
	name: string;
	/** When it was first fetched (timestamp) */
	fetchedAt: number;
	/** How many times invoked this session */
	count: number;
	/** Description from the skill metadata (if available) */
	description?: string;
	/** Whether the skill was explicitly invoked by user */
	explicit: boolean;
	/** Character count of SKILL.md content (for token estimate) */
	charCount?: number;
}

// ── Theme helpers ─────────────────────────────────────────────────────────

interface ThemeColors {
	fg: (color: string, text: string) => string;
	bg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

const defaultTheme: ThemeColors = {
	fg: (_c, s) => s,
	bg: (_c, s) => s,
	bold: (s) => s,
};

// ── SkillsTabComponent ────────────────────────────────────────────────────

class SkillsTabComponent {
	/** Max fetched skills tracked. Oldest evicted when exceeded. */
	private static readonly MAX_SKILLS = 100;

	private skills: FetchedSkill[] = [];
	/** Map from skill name → fetched skill for quick dedup lookups */
	private skillMap = new Map<string, FetchedSkill>();
	/** Lookup of available skills by name (populated from before_agent_start) */
	private availableSkills = new Map<string, Skill>();
	private scrollOffset = 0;
	private followTail = true;
	private theme: ThemeColors | null = null;
	/** Whether any skills have been captured yet */
	private hasData = false;

	// cache
	private cachedWidth?: number;
	private cachedLines?: string[];

	/** Approximate visible lines (content area is ~40 lines in the panel) */
	private visibleArea = 40;

	constructor() {}

	reset(): void {
		this.skills = [];
		this.skillMap.clear();
		this.availableSkills.clear();
		this.scrollOffset = 0;
		this.followTail = true;
		this.hasData = false;
		this.invalidate();
	}

	setTheme(theme: ThemeColors): void {
		this.theme = theme;
	}

	/** Called from before_agent_start to populate available skill metadata */
	setAvailableSkills(skills: Skill[]): void {
		this.availableSkills.clear();
		for (const s of skills) {
			this.availableSkills.set(s.name, s);
		}
		// Backfill descriptions for already-fetched skills
		for (const f of this.skills) {
			if (!f.description) {
				const m = this.availableSkills.get(f.name);
				if (m) f.description = m.description;
			}
		}
		if (this.skills.length > 0) this.invalidate();
	}

	/** Record a skill invocation (called from input event handler) */
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
			// Evict oldest when over cap
			while (this.skills.length > SkillsTabComponent.MAX_SKILLS) {
				const evicted = this.skills.shift();
				if (evicted) this.skillMap.delete(evicted.name);
			}
		}
		this.hasData = true;
		this.invalidate();
	}

	/** Set the character count for a skill's SKILL.md (from read tool result). */
	setSkillChars(name: string, charCount: number): void {
		const skill = this.skillMap.get(name);
		if (skill) {
			skill.charCount = charCount;
		}
	}

	// ── Component interface ──────────────────────────────────────────

	handleInput(data: string): void {
		const maxScroll = Math.max(0, this.skills.length - this.visibleArea);

		if (matchesKey(data, "up") || data === "k") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.followTail = false;
			this.invalidate();
			return;
		}

		if (matchesKey(data, "down") || data === "j") {
			if (this.scrollOffset < maxScroll) this.scrollOffset++;
			if (this.scrollOffset >= maxScroll) this.followTail = true;
			this.invalidate();
			return;
		}

		if (matchesKey(data, "pageup")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.visibleArea);
			this.followTail = false;
			this.invalidate();
			return;
		}

		if (matchesKey(data, "pagedown")) {
			this.scrollOffset = Math.min(
				maxScroll,
				this.scrollOffset + this.visibleArea,
			);
			if (this.scrollOffset >= maxScroll) this.followTail = true;
			this.invalidate();
			return;
		}

		if (data === "g") {
			this.scrollOffset = 0;
			this.followTail = false;
			this.invalidate();
			return;
		}

		if (data === "G") {
			this.scrollOffset = maxScroll;
			this.followTail = true;
			this.invalidate();
			return;
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		if (this.followTail && this.skills.length > 0) {
			this.scrollOffset = Math.max(0, this.skills.length - this.visibleArea);
		}

		const th = this.theme ?? defaultTheme;
		const lines: string[] = [];

		if (!this.hasData) {
			lines.push(
				th.fg("dim", truncateToWidth(" No skills fetched yet", width, "")),
			);
			lines.push("");
			lines.push(
				th.fg("dim", truncateToWidth(" Use /skill:name to load", width, "")),
			);
			lines.push(
				th.fg("dim", truncateToWidth(" or type matching trigger.", width, "")),
			);
		} else if (this.skills.length === 0) {
			lines.push(
				th.fg("dim", truncateToWidth(" No skills fetched", width, "")),
			);
		} else {
			const countStr = `${this.skills.length} fetched`;
			lines.push(
				th.fg("accent", th.bold(truncateToWidth(countStr, width, ""))),
			);
			lines.push("");

			const visible = this.skills.slice(
				this.scrollOffset,
				this.scrollOffset + this.visibleArea,
			);

			for (const skill of visible) {
				// Explicit invocations: accent. Auto-triggered: success.
				const nameColor = skill.explicit ? "accent" : "success";
				const tag = skill.explicit
					? th.fg("accent", "/")
					: th.fg("success", "~");

				const countStr =
					skill.count > 1 ? th.fg("dim", ` ×${skill.count}`) : "";

				const nameLine = ` ${tag}${th.fg(nameColor, skill.name)}${countStr}`;

				// Token size badge: right-aligned if skill was read
				if (skill.charCount != null) {
					const tokenStr = th.fg("dim", fmtTokens(est(skill.charCount)));
					const tokenVw = visibleWidth(tokenStr);
					const nameVw = visibleWidth(nameLine);
					const padding = " ".repeat(Math.max(1, width - nameVw - tokenVw));
					lines.push(nameLine + padding + tokenStr);
				} else {
					lines.push(truncateToWidth(nameLine, width, "…", false));
				}

				if (skill.description) {
					const maxDesc = Math.max(1, width - 4);
					for (const w of wordWrap(skill.description, maxDesc)) {
						lines.push(th.fg("dim", `   ${w}`));
					}
				}
			}
		}

		// Keymap footer (pinned to bottom of 40-line viewport)
		while (lines.length < 39) lines.push("");
		lines.push(
			th.fg("dim", truncateToWidth(" j/k scroll │ g/G top/bot", width, "")),
		);

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ── Filesystem skill discovery ────────────────────────────────────────────

/** Lightweight parsed skill from SKILL.md frontmatter. */
interface DiscoveredSkill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation: boolean;
}

/**
 * Scan known skill directories for SKILL.md files and extract
 * name + description from YAML frontmatter. Runs during session_start
 * so descriptions are available immediately, even before the first
 * before_agent_start event fires on reconnect.
 */
async function discoverSkills(): Promise<DiscoveredSkill[]> {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const os = await import("node:os");
	const home = os.homedir();

	const skillDirs: string[] = [path.join(home, ".pi", "agent", "skills")];

	// Also scan npm-packaged skills
	const npmSkillsBase = path.join(home, ".pi", "agent", "npm", "node_modules");
	try {
		const pkgs = await fs.readdir(npmSkillsBase);
		for (const pkg of pkgs) {
			const skillsPath = path.join(npmSkillsBase, pkg, "skills");
			try {
				await fs.access(skillsPath);
				skillDirs.push(skillsPath);
			} catch {
				// No skills/ subdirectory in this package
			}
		}
	} catch {
		// npm dir doesn't exist
	}

	const discovered: DiscoveredSkill[] = [];

	for (const base of skillDirs) {
		let entries: string[];
		try {
			entries = await fs.readdir(base, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const skillDir = path.join(base, entry.name);
			const mdPath = path.join(skillDir, "SKILL.md");

			let content: string;
			try {
				content = await fs.readFile(mdPath, "utf-8");
			} catch {
				continue;
			}

			// Parse YAML frontmatter between --- delimiters
			const fm = extractFrontmatter(content);
			const name = fm.name || entry.name;
			const description = fm.description || "";

			discovered.push({
				name,
				description,
				filePath: mdPath,
				baseDir: skillDir,
				disableModelInvocation: false,
			});
		}
	}

	return discovered;
}

/** Extract key-value pairs from YAML frontmatter (--- delimited). */
function extractFrontmatter(content: string): Record<string, string> {
	const result: Record<string, string> = {};

	// Find first ---
	const start = content.indexOf("---");
	if (start !== 0) return result;

	const end = content.indexOf("---", start + 3);
	if (end < 0) return result;

	const fm = content.slice(start + 3, end);

	// Simple line-by-line parser for name: value and description: >
	const lines = fm.split("\n");
	let currentKey = "";
	let currentValue = "";

	for (const line of lines) {
		const keyMatch = /^(\w+):\s*(.*)/.exec(line);
		if (keyMatch) {
			// Flush previous key
			if (currentKey) {
				result[currentKey] = currentValue.trim();
			}
			currentKey = keyMatch[1]!;
			const val = keyMatch[2]!.trim();
			if (val === ">" || val === "|") {
				currentValue = ""; // folded/block scalar — accumulate next lines
			} else {
				currentValue = val;
				result[currentKey] = val;
				currentKey = "";
			}
		} else if (currentKey) {
			// Continuation of folded scalar (>)
			const trimmed = line.trim();
			if (trimmed) {
				currentValue += (currentValue ? " " : "") + trimmed;
			}
		}
	}

	// Flush last key
	if (currentKey) {
		result[currentKey] = currentValue.trim();
	}

	return result;
}

// ── Extension entry point ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const skillsComponent = new SkillsTabComponent();
	let registered = false;

	function registerTab(): void {
		if (registered) return;
		registered = true;

		try {
			const themedComponent = {
				handleInput(data: string): void {
					skillsComponent.handleInput(data);
				},
				render(width: number): string[] {
					return skillsComponent.render(width);
				},
				invalidate(): void {
					skillsComponent.invalidate();
				},
				setTheme(t: ThemeColors): void {
					skillsComponent.setTheme(t);
				},
			};

			pi.events.emit("sidepanel:register", {
				id: "skills",
				label: "Skills",
				component: themedComponent,
			});
		} catch {
			// silent
		}
	}

	// ── Session start: reset, replay history, register ─────────────

	pi.on("session_start", (_event, ctx) => {
		registered = false;
		skillsComponent.reset();

		// Register tab immediately — framework shows empty state while we replay
		registerTab();

		// Discover skills from filesystem so descriptions load
		// immediately — before_agent_start may not fire on reconnect.
		discoverSkills().then((discovered) => {
			skillsComponent.setAvailableSkills(discovered);
			pi.events.emit("sidepanel:invalidate", { tabId: "skills" });
		});

		// Replay session: catch skill reads that already happened
		try {
			const entries = ctx.sessionManager.getEntries() as Array<{
				type: string;
				message?: {
					role: string;
					toolName?: string;
					toolCallId?: string;
					content?: Array<{
						type: string;
						name?: string;
						text?: string;
						arguments?: { path?: string };
					}>;
				};
			}>;

			const readPaths = new Map<string, string>();

			for (const entry of entries) {
				if (entry.type !== "message") continue;
				const msg = entry.message;
				if (!msg) continue;

				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block.type === "toolCall" && block.name === "read") {
							const p = block.arguments?.path;
							if (p) {
								const re = /\/skills\/([\w-]+)(?:\/SKILL)?\.md$/i;
								const m = re.exec(p);
								if (m) {
									skillsComponent.addFetchedSkill(m[1]!, false);
									// Track callId → skillName for result replay
									// Use block.id or a generated key
									const callId = (block as any).id;
									if (callId) readPaths.set(callId, m[1]!);
								}
							}
						}
					}
				} else if (msg.role === "toolResult" && msg.toolName === "read") {
					// Try match by callId first, then by path
					const callId = msg.toolCallId;
					let skillName = callId ? readPaths.get(callId) : undefined;

					// Fallback: extract skill name from result content if available
					if (!skillName && Array.isArray(msg.content)) {
						const rawText = msg.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text ?? "")
							.join("");
						// Try to find skill name in frontmatter of content
						const fmMatch = /^---\nname:\s*(\S+)/m.exec(rawText);
						if (fmMatch) skillName = fmMatch[1]!;
					}

					if (skillName && Array.isArray(msg.content)) {
						const rawText = msg.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text ?? "")
							.join("");
						if (rawText) {
							skillsComponent.setSkillChars(skillName, rawText.length);
						}
					}
				}
			}
			pi.events.emit("sidepanel:invalidate", { tabId: "skills" });
		} catch {
			// Replay failed — tab already registered with empty state
		}
	});

	// ── Populate available skill metadata (for descriptions) ─────────

	pi.on("before_agent_start", async (event, _ctx) => {
		const skills = (event.systemPromptOptions.skills ?? []) as Skill[];
		skillsComponent.setAvailableSkills(skills);
		pi.events.emit("sidepanel:invalidate", { tabId: "skills" });
	});

	// ── Track skill invocations ────────────────────────────────────

	// 1. Explicit /skill:NAME commands
	pi.on("input", async (event, _ctx) => {
		const re = /\/skill:([\w-]+)/g;
		let match: RegExpExecArray | null;
		let found = false;
		while ((match = re.exec(event.text)) !== null) {
			skillsComponent.addFetchedSkill(match[1]!, true);
			found = true;
		}
		if (found) {
			pi.events.emit("sidepanel:invalidate", { tabId: "skills" });
		}
	});

	// 2. LLM reads a SKILL.md file (skill auto-triggered / loaded)
	//    Skill baseDir is e.g. /home/werner/.pi/agent/skills/caveman/
	//    The SKILL.md path would be .../skills/NAME/SKILL.md
	pi.on("tool_call", async (event, _ctx) => {
		if (event.toolName !== "read") return;
		const path = (event.input as { path?: string }).path;
		if (!path) return;

		// Match paths ending in /skills/<name>/SKILL.md or /skills/<name>.md
		const re = /\/skills\/([\w-]+)(?:\/SKILL)?\.md$/i;
		const m = re.exec(path);
		if (m) {
			skillsComponent.addFetchedSkill(m[1]!, false);
			pi.events.emit("sidepanel:invalidate", { tabId: "skills" });
		}
	});

	// 3. Capture SKILL.md content size from read results
	pi.on("tool_result", async (event, _ctx) => {
		if (event.toolName !== "read") return;
		const p = (event.input as { path?: string }).path;
		if (!p) return;

		const re = /\/skills\/([\w-]+)(?:\/SKILL)?\.md$/i;
		const m = re.exec(p);
		if (!m) return;

		const content = (event.content ?? []) as Array<{
			type: string;
			text?: string;
		}>;
		const rawText = content
			.filter((c: { type: string }) => c.type === "text")
			.map((c: { text?: string }) => c.text ?? "")
			.join("");
		if (rawText) {
			skillsComponent.setSkillChars(m[1]!, rawText.length);
			pi.events.emit("sidepanel:invalidate", { tabId: "skills" });
		}
	});

	// ── Fallback registration ────────────────────────────────────────

	pi.events.on("sidepanel:ready", () => {
		if (!registered) registerTab();
	});
}
