/*
 * Launch Timer
 *
 * One stored thing: a T-zero date, under the key `t0`.
 *   - On a note:  front matter  `t0: 2026-10-08`
 *   - On a task:  inline field  `- [ ] Do the thing [t0:: 2026-10-08]`
 *
 * You type a number of days (14). The plugin writes today + 14 as the date.
 * The counter is never stored. It is worked out when it is shown:
 *   counter = today - t0   → -14 … -1, 0, 1, 2, 3 …
 * Working on the thing changes nothing. Only setting a new window does.
 *
 * The badge is five dots on a fixed 21-day scale, no number:
 *   Always reads left to right, like time passing:
 *   before T0  neutral dots sit at the right end; empty space fills in from the left
 *   after T0   accent-colour dots grow from the left; empty space on the right
 * Hover shows the number and the date.
 *
 * When a task with a t0 is checked off, the plugin adds a
 * `[tc:: date]` field. A done task's dots freeze where it landed.
 *
 * Display:
 *   Source mode   raw text, no badges.
 *   Live Preview  the badge stands in for the date. Put the cursor on the
 *                 line (or click the badge) and the raw text comes back.
 *                 A setting keeps dates always visible, badge beside them.
 *   Reading view  same rule as Live Preview, minus the cursor.
 *
 * No build step. Plain JavaScript against Obsidian's API.
 */

const {
	Plugin, Modal, Setting, Notice, PluginSettingTab, MarkdownView, editorLivePreviewField,
} = require("obsidian");
const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view");
const { RangeSetBuilder, Prec } = require("@codemirror/state");

const KEY = "t0";
const DONE_KEY = "tc"; // matches the completion field name set in Dataview's settings

const T0_RE = /\[t0::\s*(\d{4}-\d{2}-\d{2})\s*\]/;
const T0_RE_G = /\[t0::\s*(\d{4}-\d{2}-\d{2})\s*\]/g;
const DONE_RE = /\[tc::\s*(\d{4}-\d{2}-\d{2})\s*\]/;
const DONE_RE_G = /\s*\[tc::\s*\d{4}-\d{2}-\d{2}\s*\]/g;
const CHECKBOX_RE = /^\s*(?:[-*+]|\d+[.)])\s\[(.)\]\s/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

const DEFAULTS = {
	hideDates: true,        // badge stands in for the date until you're on the line
	stampCompletion: true,  // add [tc:: date] when a t0 task is checked
	showNumber: false,      // dots only, unless you want the T-number beside them
};

// Bumped when a setting changes; widgets also redraw when the day changes.
let SETTINGS_VERSION = 0;
const renderKey = () => SETTINGS_VERSION + "|" + window.moment().format("YYYY-MM-DD");

// ---------- date helpers ----------

const today = () => window.moment().startOf("day");

function dateFromWindow(days) {
	return today().add(days, "days").format("YYYY-MM-DD");
}

function parse(d) {
	const m = window.moment(String(d), "YYYY-MM-DD", true);
	return m.isValid() ? m : null;
}

// today - t0, in days
function counterFor(t0) {
	const d = parse(t0);
	return d ? today().diff(d, "days") : null;
}

// completion - t0, in days: where on the clock it got done
function landedAt(t0, done) {
	const a = parse(t0), b = parse(done);
	return a && b ? b.diff(a, "days") : null;
}

function tLabel(n) {
	if (n === null) return "T?";
	if (n < 0) return "T" + n;
	if (n === 0) return "T0";
	return "T+" + n;
}

// ---------- the dots ----------
// Fixed scale: 21 days across five dots, about 4 days a dot.
// Reads left to right, like time passing.
// Before T0: neutral dots sit at the right end; empty slots fill in from the left as T0 gets close.
//            21+ days out = all five. The day before = one. T0 = none.
// After T0:  accent dots grow from the left toward the right. 1 day past = one. 21+ = five.
// Empty slots stay as faint outlines so the shape holds still.

const SCALE = 21;
const DOTS = 5;
let SHOW_NUMBER = false; // set from settings

function dotCounts(n) {
	if (n === null) return { before: 0, after: 0 };
	if (n < 0) return { before: Math.min(DOTS, Math.ceil((-n / SCALE) * DOTS)), after: 0 };
	if (n > 0) return { before: 0, after: Math.min(DOTS, Math.ceil((n / SCALE) * DOTS)) };
	return { before: 0, after: 0 };
}

function dotsEl(n) {
	const wrap = document.createElement("span");
	wrap.className = "lt-dots";
	const { before, after } = dotCounts(n);
	for (let i = 0; i < DOTS; i++) {
		const d = document.createElement("span");
		d.className = "lt-dot " + (i >= DOTS - before ? "lt-dot-before" : i < after ? "lt-dot-after" : "lt-dot-empty");
		wrap.appendChild(d);
	}
	return wrap;
}

// info = { t0, checked, completion }
function badgeEl(info) {
	const el = document.createElement("span");
	let n, cls, tip;
	if (info.checked) {
		// Frozen where it landed, dimmed.
		n = info.completion ? landedAt(info.t0, info.completion) : null;
		cls = "lt-done";
		tip = `Done${n === null ? "" : " at " + tLabel(n)} · T-zero ${info.t0}` + (info.completion ? ` · done ${info.completion}` : "");
	} else {
		n = counterFor(info.t0);
		cls = n === null ? "lt-bad" : n < 0 ? "lt-before" : n === 0 ? "lt-zero" : "lt-after";
		tip = `${tLabel(n)} · T-zero ${info.t0}`;
	}
	el.className = "launch-timer-badge " + cls;
	if (info.checked) el.createSpan({ cls: "lt-check", text: "✓" });
	el.appendChild(dotsEl(n));
	if (SHOW_NUMBER) el.createSpan({ cls: "lt-num", text: tLabel(n) });
	el.setAttribute("aria-label", tip); // hover shows the number and the date
	return el;
}

function infoFromLine(text) {
	const t = text.match(T0_RE);
	if (!t) return null;
	const c = text.match(CHECKBOX_RE);
	const d = text.match(DONE_RE);
	return {
		t0: t[1],
		checked: !!c && (c[1] === "x" || c[1] === "X"),
		completion: d ? d[1] : null,
	};
}

// ---------- modal: ask for a number ----------

class WindowModal extends Modal {
	constructor(app, onSubmit) {
		super(app);
		this.onSubmit = onSubmit;
		this.value = "14";
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Launch window" });
		contentEl.createEl("p", { text: "How many days from today? 0 means today. A negative number starts the clock already running." });
		new Setting(contentEl).setName("Days").addText((t) => {
			t.setValue(this.value);
			t.inputEl.type = "number";
			t.onChange((v) => (this.value = v));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); this.submit(); }
			});
			setTimeout(() => { t.inputEl.focus(); t.inputEl.select(); }, 0);
		});
		new Setting(contentEl).addButton((b) => b.setButtonText("Set").setCta().onClick(() => this.submit()));
	}
	submit() {
		const n = parseInt(this.value, 10);
		if (Number.isNaN(n)) { new Notice("That isn't a number."); return; }
		this.close();
		this.onSubmit(n);
	}
	onClose() { this.contentEl.empty(); }
}

// ---------- Live Preview ----------

class BadgeWidget extends WidgetType {
	constructor(info, pos) { super(); this.info = info; this.pos = pos; this.key = renderKey(); }
	eq(o) {
		return o.key === this.key && o.pos === this.pos && o.info.t0 === this.info.t0 &&
			o.info.checked === this.info.checked && o.info.completion === this.info.completion;
	}
	toDOM(view) {
		const el = badgeEl(this.info);
		el.addClass("lt-clickable");
		// Click the badge → cursor goes into the field → the raw text shows.
		el.addEventListener("mousedown", (e) => {
			e.preventDefault();
			view.dispatch({ selection: { anchor: this.pos + 1 } });
			view.focus();
		});
		return el;
	}
	ignoreEvent() { return false; }
}

const HIDE = Decoration.replace({});

function livePreviewExtension(plugin) {
	return Prec.highest(ViewPlugin.fromClass(
		class {
			constructor(view) { this.decorations = this.build(view); }
			update(u) {
				const modeChanged =
					u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
				if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || modeChanged ||
					u.transactions.some((t) => t.reconfigured)) {
					this.decorations = this.build(u.view);
				}
			}
			build(view) {
				const b = new RangeSetBuilder();
				if (!view.state.field(editorLivePreviewField, false)) return b.finish(); // Source mode: raw text only
				const hide = plugin.settings.hideDates;
				const doc = view.state.doc;
				const sel = view.state.selection.ranges;
				const seen = new Set();
				for (const { from, to } of view.visibleRanges) {
					let pos = from;
					while (pos <= to) {
						const line = doc.lineAt(pos);
						pos = line.to + 1;
						if (seen.has(line.number)) continue;
						seen.add(line.number);
						const info = infoFromLine(line.text);
						if (!info) continue;
						const onLine = view.hasFocus && sel.some((r) => r.from <= line.to && r.to >= line.from);
						const t = line.text.match(T0_RE);
						const tFrom = line.from + t.index, tTo = tFrom + t[0].length;
						const decos = [];
						if (hide && !onLine) {
							decos.push([tFrom, tTo, Decoration.replace({ widget: new BadgeWidget(info, tFrom) })]);
							const d = DONE_RE.exec(line.text);
							if (d) {
								// swallow the space in front of the completion field too
								let dFrom = line.from + d.index;
								while (dFrom > line.from && line.text[dFrom - line.from - 1] === " ") dFrom--;
								decos.push([dFrom, line.from + d.index + d[0].length, HIDE]);
							}
						} else if (!hide) {
							decos.push([tTo, tTo, Decoration.widget({ widget: new BadgeWidget(info, tFrom), side: 1 })]);
						}
						decos.sort((a, c) => a[0] - c[0]);
						for (const [f, tt, deco] of decos) b.add(f, tt, deco);
					}
				}
				return b.finish();
			}
		},
		{ decorations: (v) => v.decorations }
	));
}

// ---------- the plugin ----------

module.exports = class LaunchTimer extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULTS, await this.loadData());
		SHOW_NUMBER = this.settings.showNumber;
		this.addSettingTab(new LaunchTimerSettings(this.app, this));

		// Note-level: set the window
		this.addCommand({
			id: "set-note-window",
			name: "Set launch window on this note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) {
					new WindowModal(this.app, async (n) => {
						const t0 = dateFromWindow(n);
						await this.app.fileManager.processFrontMatter(file, (fm) => { fm[KEY] = t0; });
						new Notice(`T-zero set to ${t0} (${tLabel(counterFor(t0))})`);
						this.refreshStatus();
					}).open();
				}
				return true;
			},
		});

		// Note-level: clear
		this.addCommand({
			id: "clear-note-window",
			name: "Clear launch window on this note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
				if (!fm || !(KEY in fm)) return false;
				if (!checking) {
					this.app.fileManager.processFrontMatter(file, (f) => { delete f[KEY]; })
						.then(() => this.refreshStatus());
				}
				return true;
			},
		});

		// Task-level: set the window on the checkbox line under the cursor
		this.addCommand({
			id: "set-task-window",
			name: "Set launch window on this task",
			editorCheckCallback: (checking, editor) => {
				const lineNo = editor.getCursor().line;
				const line = editor.getLine(lineNo);
				if (!CHECKBOX_RE.test(line)) return false;
				if (!checking) {
					new WindowModal(this.app, (n) => {
						const t0 = dateFromWindow(n);
						const field = `[${KEY}:: ${t0}]`;
						const anyT0 = /\s*\[t0::[^\]]*\]/;
						const next = anyT0.test(line)
							? line.replace(anyT0, " " + field)
							: line.replace(/\s*$/, "") + " " + field;
						editor.setLine(lineNo, next);
						new Notice(`Task T-zero set to ${t0} (${tLabel(counterFor(t0))})`);
					}).open();
				}
				return true;
			},
		});

		// Status bar: the active note's counter
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("launch-timer-status");
		this.registerEvent(this.app.workspace.on("file-open", () => this.refreshStatus()));
		this.registerEvent(this.app.metadataCache.on("changed", (file, data, cache) => {
			if (file === this.app.workspace.getActiveFile()) this.refreshStatus();
			this.stampCompletions(file, data, cache);
		}));
		// Check every 10 minutes; when the date has changed, redraw everything.
		this.day = window.moment().format("YYYY-MM-DD");
		this.registerInterval(window.setInterval(() => {
			const d = window.moment().format("YYYY-MM-DD");
			if (d === this.day) return;
			this.day = d;
			this.refreshStatus();
			this.redrawAll();
		}, 10 * 60 * 1000));
		this.refreshStatus();

		// Badges
		this.registerEditorExtension(livePreviewExtension(this));
		this.registerMarkdownPostProcessor((el, ctx) => this.decorateReading(el, ctx), 100);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		SHOW_NUMBER = this.settings.showNumber;
		SETTINGS_VERSION++;
		this.refreshStatus();
		this.redrawAll();
	}

	redrawAll() {
		this.app.workspace.updateOptions(); // redraw Live Preview
		this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode?.rerender(true);
		});
	}

	refreshStatus() {
		if (!this.statusEl) return;
		const file = this.app.workspace.getActiveFile();
		const t0 = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.[KEY];
		this.statusEl.empty();
		if (!t0) return;
		this.statusEl.appendChild(badgeEl({ t0: String(t0), checked: false, completion: null }));
	}

	// ----- completion stamping -----
	// Checked + has t0 + no completion → add [tc:: today].
	// Unchecked + has completion → take it off. Same as Dataview's own tracking.
	stampCompletions(file, data, cache) {
		if (!this.settings.stampCompletion || !cache?.listItems) return;
		const lines = data.split("\n");
		const stamp = today().format("YYYY-MM-DD");
		const edits = [];
		for (const item of cache.listItems) {
			if (item.task === undefined) continue;
			const n = item.position.start.line;
			const text = lines[n];
			if (!text || !T0_RE.test(text)) continue;
			const done = item.task === "x" || item.task === "X";
			const has = DONE_RE.test(text);
			if (done && !has) edits.push([n, text, text.replace(/\s*$/, "") + ` [${DONE_KEY}:: ${stamp}]`]);
			else if (!done && has) edits.push([n, text, text.replace(DONE_RE_G, "")]);
		}
		if (!edits.length) return;

		// If the note is open, edit through the editor so the cursor stays put.
		const view = this.app.workspace.getLeavesOfType("markdown")
			.map((l) => l.view)
			.find((v) => v instanceof MarkdownView && v.file === file && v.getMode() === "source");
		if (view) {
			const ed = view.editor;
			for (const [n, before, after] of edits) {
				if (ed.getLine(n) === before) ed.replaceRange(after, { line: n, ch: 0 }, { line: n, ch: before.length });
			}
			return;
		}
		this.app.vault.process(file, (d) => {
			const ls = d.split("\n");
			for (const [n, before, after] of edits) if (ls[n] === before) ls[n] = after;
			return ls.join("\n");
		});
	}

	// ----- Reading view -----
	// Works on raw [t0:: …] text, and on Dataview's rendered inline-field
	// spans if Dataview got there first.
	decorateReading(el, ctx) {
		const hide = this.settings.hideDates;

		// Map each rendered <li> to its source line, so we know the real
		// t0 / completion / checked state even after Dataview reformats them.
		const infoByLi = new Map();
		const sec = ctx.getSectionInfo(el);
		const lis = Array.from(el.querySelectorAll("li"));
		if (sec && lis.length) {
			const src = sec.text.split("\n").slice(sec.lineStart, sec.lineEnd + 1).filter((l) => LIST_ITEM_RE.test(l));
			if (src.length === lis.length) lis.forEach((li, i) => infoByLi.set(li, infoFromLine(src[i])));
		}
		const ownerLi = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest("li") || null;
		const infoFor = (node, fallbackText) => {
			const li = ownerLi(node);
			if (li && infoByLi.has(li)) return infoByLi.get(li);
			const info = fallbackText ? infoFromLine(fallbackText) : null;
			if (info && li) {
				info.checked = li.dataset.task === "x" || li.dataset.task === "X" || li.classList.contains("is-checked");
				const d = (li.textContent || "").match(DONE_RE);
				info.completion = d ? d[1] : null;
			}
			return info;
		};

		// 1. Raw text fields
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const hits = [];
		let node;
		while ((node = walker.nextNode())) {
			if (/\[(t0|tc)::/.test(node.nodeValue)) hits.push(node);
		}
		for (const textNode of hits) {
			const s = textNode.nodeValue;
			const frag = document.createDocumentFragment();
			let last = 0, m;
			T0_RE_G.lastIndex = 0;
			while ((m = T0_RE_G.exec(s))) {
				const info = infoFor(textNode, m[0]) || { t0: m[1], checked: false, completion: null };
				const before = s.slice(last, m.index);
				frag.append(hide ? before.replace(/\s+$/, " ") : before + m[0]);
				frag.append(badgeEl(info));
				last = m.index + m[0].length;
			}
			let rest = s.slice(last);
			if (hide) rest = rest.replace(DONE_RE_G, "");
			frag.append(rest);
			textNode.replaceWith(frag);
		}

		// 2. Dataview-rendered fields
		el.querySelectorAll(".inline-field").forEach((f) => {
			const key = f.querySelector(".inline-field-key")?.getAttribute("data-dv-key")
				|| f.querySelector(".inline-field-key")?.textContent?.trim();
			if (key === DONE_KEY && hide) { f.remove(); return; }
			if (key !== KEY) return;
			let info = infoFor(f, null);
			if (!info) {
				// No source line (e.g. inside a Dataview TASK query). Read Dataview's
				// formatted date back; its default format is "October 01, 2026".
				const shown = f.querySelector(".inline-field-value")?.textContent?.trim();
				const d = shown && window.moment(shown, ["YYYY-MM-DD", "MMMM DD, YYYY", "MMMM D, YYYY"], true);
				if (!d || !d.isValid()) return; // can't tell; leave Dataview's rendering alone
				const li = ownerLi(f);
				info = {
					t0: d.format("YYYY-MM-DD"),
					checked: !!li && (li.dataset.task === "x" || li.classList.contains("is-checked")),
					completion: null,
				};
			}
			const badge = badgeEl(info);
			if (hide) f.replaceWith(badge);
			else f.after(badge);
		});
	}
};

// ---------- settings ----------

class LaunchTimerSettings extends PluginSettingTab {
	constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
	display() {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName("Badge stands in for the date")
			.setDesc("On: Live Preview and Reading view show only the badge. Put the cursor on the line, or click the badge, to see and edit the date. Off: the date stays visible with the badge beside it. Source mode always shows raw text.")
			.addToggle((t) => t.setValue(this.plugin.settings.hideDates).onChange(async (v) => {
				this.plugin.settings.hideDates = v;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
			.setName("Show the number beside the dots")
			.setDesc("Off: dots only. Hovering a badge always shows the number and the date.")
			.addToggle((t) => t.setValue(this.plugin.settings.showNumber).onChange(async (v) => {
				this.plugin.settings.showNumber = v;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
			.setName("Stamp completion date")
			.setDesc("When a task with a t0 is checked, add [tc:: date] (the completion field name in Dataview's settings). Unchecking removes it. The done badge shows where on the clock it landed.")
			.addToggle((t) => t.setValue(this.plugin.settings.stampCompletion).onChange(async (v) => {
				this.plugin.settings.stampCompletion = v;
				await this.plugin.saveSettings();
			}));
	}
}
