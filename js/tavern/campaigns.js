/** Campaigns page: create/join adventures, and the in-game event log. */

import {TavernApi} from "./tavern-api.js";
import {avatarHtml, esc, fmtDateTime, pLoadUser, renderHero, renderSignInPrompt, rollFormula, toast} from "./tavern-ui.js";

const hero = document.getElementById("tvn-hero");
const root = document.getElementById("tvn-root");

const POLL_INTERVAL_MS = 5000;

let currentUser = null;
let pollTimer = null;

const stopPolling = () => {
	if (pollTimer) clearInterval(pollTimer);
	pollTimer = null;
};

const STATUS_BADGES = {
	recruiting: "gold",
	active: "player",
	completed: "muted",
	archived: "muted",
};

/* ==================== Adventure list ==================== */

const renderList = async () => {
	stopPolling();
	location.hash = "";
	renderHero(hero, {
		title: "Campaigns",
		subtitle: "Found an adventure as Dungeon Master, or join a party with a six-letter invite code.",
		user: currentUser,
	});
	root.innerHTML = `<div class="tvn-loading">Reading the notice board</div>`;

	let adventures, characters;
	try {
		[{adventures}, {characters}] = await Promise.all([TavernApi.pGetAdventures(), TavernApi.pGetCharacters()]);
	} catch (e) {
		root.innerHTML = `<div class="tvn-card tvn-empty">${esc(e.message)}</div>`;
		return;
	}

	const activeCharacters = characters.filter(c => !c.isRetired);

	const cards = adventures.map(a => `
		<div class="tvn-card tvn-card--corners tvn-char-card" data-id="${a.id}">
			<div class="tvn-flex-between">
				<h3 class="tvn-char-card__name">${esc(a.name)}</h3>
				<span class="tvn-badge tvn-badge--${a.myRole === "dm" ? "dm" : "player"}">${a.myRole === "dm" ? "DM" : "Player"}</span>
			</div>
			<div class="tvn-char-card__meta">
				<span class="tvn-badge tvn-badge--${STATUS_BADGES[a.status] || "muted"}">${esc(a.status)}</span>
				· ${a.memberCount} member${a.memberCount === 1 ? "" : "s"} · since ${fmtDateTime(a.createdAt)}
			</div>
			${a.description ? `<div class="tvn-muted" style="font-size: 13px;">${esc(a.description)}</div>` : ""}
		</div>
	`).join("");

	root.innerHTML = `
		<div class="tvn-grid" style="margin-bottom: 18px;">
			<div class="tvn-card tvn-card--corners">
				<h2 class="tvn-card__title">Found an Adventure</h2>
				<p class="tvn-card__hint">You become its Dungeon Master.</p>
				<form id="form-create">
					<div class="tvn-field"><label class="tvn-label">Name</label><input class="tvn-input" name="name" required maxlength="128" placeholder="Curse of the Amber Crown"></div>
					<div class="tvn-field"><label class="tvn-label">Description</label><textarea class="tvn-textarea" name="description" rows="2"></textarea></div>
					<button class="tvn-btn" type="submit">Found Adventure</button>
					<p class="tvn-error" id="create-error"></p>
				</form>
			</div>

			<div class="tvn-card tvn-card--corners">
				<h2 class="tvn-card__title">Join a Party</h2>
				<p class="tvn-card__hint">Ask your DM for the invite code.</p>
				<form id="form-join">
					<div class="tvn-field"><label class="tvn-label">Invite Code</label><input class="tvn-input" name="code" required maxlength="12" style="text-transform: uppercase; letter-spacing: 0.2em;" placeholder="ABC123"></div>
					<div class="tvn-field">
						<label class="tvn-label">Play As</label>
						<select class="tvn-select" name="characterId">
							<option value="">Choose later…</option>
							${activeCharacters.map(c => `<option value="${c.id}">${esc(c.name)} (Lv ${c.level} ${esc(c.className || "")})</option>`).join("")}
						</select>
					</div>
					<button class="tvn-btn" type="submit">Join Adventure</button>
					<p class="tvn-error" id="join-error"></p>
				</form>
			</div>
		</div>

		<h2 class="tvn-section-title">Your Adventures</h2>
		<div class="tvn-grid">${cards || ""}</div>
		${!adventures.length ? `<div class="tvn-empty">No adventures yet — the road awaits.</div>` : ""}
	`;

	root.querySelectorAll(".tvn-char-card[data-id]").forEach(card => {
		card.addEventListener("click", () => renderAdventure(Number(card.dataset.id)));
	});

	root.querySelector("#form-create").addEventListener("submit", async evt => {
		evt.preventDefault();
		const errorEl = root.querySelector("#create-error");
		errorEl.textContent = "";
		const data = new FormData(evt.target);
		try {
			const {adventure} = await TavernApi.pCreateAdventure({name: data.get("name"), description: data.get("description")});
			toast(`Adventure founded — invite code ${adventure.joinCode}`);
			renderAdventure(adventure.id);
		} catch (e) {
			errorEl.textContent = e.message;
		}
	});

	root.querySelector("#form-join").addEventListener("submit", async evt => {
		evt.preventDefault();
		const errorEl = root.querySelector("#join-error");
		errorEl.textContent = "";
		const data = new FormData(evt.target);
		const characterId = data.get("characterId") ? Number(data.get("characterId")) : null;
		try {
			const {adventure} = await TavernApi.pJoinAdventure(data.get("code"), characterId);
			toast("You have joined the party!");
			renderAdventure(adventure.id);
		} catch (e) {
			errorEl.textContent = e.message;
		}
	});
};

/* ==================== Adventure detail ==================== */

const EVENT_TYPE_OPTIONS = {
	dm: [
		["narration", "Narrate"],
		["speech", "Speak"],
		["action", "Action"],
		["roll", "Roll Dice"],
		["note", "DM Note"],
		["ooc", "Out of Character"],
	],
	player: [
		["speech", "Speak"],
		["action", "Action"],
		["roll", "Roll Dice"],
		["ooc", "Out of Character"],
	],
};

const eventHtml = (event, myRole, myMemberId) => {
	const canDelete = myRole === "dm" || event.memberId === myMemberId;
	const who = event.type === "system"
		? ""
		: `<b>${esc(event.characterName || event.authorName || "Unknown")}</b>${event.characterName && event.authorName ? ` <span>(${esc(event.authorName)})</span>` : ""}`;

	let body;
	if (event.type === "roll" && event.data?.rolls) {
		const detail = (event.data.rolls || []).map(r => `<span class="tvn-die">${esc(r.die)}</span> [${(r.results || []).join(", ")}]`).join(" + ");
		const modifier = event.data.modifier ? ` ${event.data.modifier > 0 ? "+" : ""}${event.data.modifier}` : "";
		body = `${event.content ? `${esc(event.content)} — ` : ""}${esc(event.data.formula || "")}: ${detail}${modifier} = <span class="tvn-roll-total">${event.data.total}</span>`;
	} else {
		body = esc(event.content);
	}

	return `
		<div class="tvn-event tvn-event--${esc(event.type)}">
			${event.type === "system" ? "" : `
			<div class="tvn-event__meta">
				${who}
				<span>${fmtDateTime(event.createdAt)}</span>
				${canDelete ? `<a href="#" class="tvn-muted" data-delete-event="${event.id}" title="Delete">✕</a>` : ""}
			</div>`}
			<div class="tvn-event__body">${body}</div>
		</div>
	`;
};

const renderAdventure = async (adventureId) => {
	stopPolling();
	location.hash = `#/a/${adventureId}`;
	root.innerHTML = `<div class="tvn-loading">Opening the chronicle</div>`;

	let adventure, characters;
	try {
		[{adventure}, {characters}] = await Promise.all([TavernApi.pGetAdventure(adventureId), TavernApi.pGetCharacters()]);
	} catch (e) {
		toast(e.message, "danger");
		return renderList();
	}

	const myMember = adventure.members.find(m => m.userId === currentUser.id);
	const myRole = adventure.myRole;
	const isDm = myRole === "dm";
	const activeCharacters = characters.filter(c => !c.isRetired);

	renderHero(hero, {
		title: adventure.name,
		subtitle: adventure.description || "The chronicle of your adventure, kept faithfully.",
		user: currentUser,
	});

	const membersHtml = adventure.members.map(m => `
		<div class="tvn-member">
			${avatarHtml(m.avatarUrl, m.displayName)}
			<div style="flex: 1; min-width: 0;">
				<div class="tvn-member__name">${esc(m.displayName)} <span class="tvn-badge tvn-badge--${m.role === "dm" ? "dm" : "player"}">${m.role === "dm" ? "DM" : "Player"}</span></div>
				<div class="tvn-member__char">${m.character ? `${esc(m.character.name)} — Lv ${m.character.level} ${esc(m.character.className || "")}` : "No character chosen"}</div>
			</div>
			${isDm && m.userId !== currentUser.id ? `<button class="tvn-btn tvn-btn--danger tvn-btn--sm" data-kick="${m.id}" title="Remove">✕</button>` : ""}
		</div>
	`).join("");

	root.innerHTML = `
		<div class="tvn-flex-between" style="margin-bottom: 12px;">
			<button class="tvn-btn tvn-btn--ghost tvn-btn--sm" id="btn-back">← All campaigns</button>
			<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
				${isDm ? `
					<select class="tvn-select" id="sel-status" style="width: auto;">
						${["recruiting", "active", "completed", "archived"].map(s => `<option ${adventure.status === s ? "selected" : ""}>${s}</option>`).join("")}
					</select>
					<span class="tvn-muted" style="font-size: 12px;">Invite:</span> <span class="tvn-code">${esc(adventure.joinCode)}</span>
				` : `<span class="tvn-badge tvn-badge--${STATUS_BADGES[adventure.status] || "muted"}">${esc(adventure.status)}</span>`}
			</div>
		</div>

		<div class="tvn-adventure-layout">
			<div class="tvn-card tvn-card--corners">
				<h2 class="tvn-card__title tvn-mt-0">Chronicle</h2>
				<div class="tvn-log" id="event-log"><div class="tvn-loading">Turning pages</div></div>

				<div class="tvn-composer">
					<select class="tvn-select" id="sel-type">
						${EVENT_TYPE_OPTIONS[isDm ? "dm" : "player"].map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
					</select>
					<input class="tvn-input tvn-composer__input" id="input-content" placeholder="What happens next?">
					<input class="tvn-input" id="input-formula" placeholder="e.g. 1d20+5" style="display: none; width: 120px;">
					<button class="tvn-btn" id="btn-send">Send</button>
				</div>
				<p class="tvn-error" id="composer-error"></p>
			</div>

			<div class="tvn-card tvn-card--corners">
				<h2 class="tvn-card__title tvn-mt-0">The Party</h2>
				<div id="member-list">${membersHtml}</div>
				<hr class="tvn-rule">
				<div class="tvn-field">
					<label class="tvn-label">Your Character</label>
					<select class="tvn-select" id="sel-my-char">
						<option value="">None</option>
						${activeCharacters.map(c => `<option value="${c.id}" ${myMember?.character?.id === c.id ? "selected" : ""}>${esc(c.name)} (Lv ${c.level})</option>`).join("")}
					</select>
				</div>
				${!isDm ? `<button class="tvn-btn tvn-btn--danger tvn-btn--sm" id="btn-leave">Leave party</button>` : ""}
			</div>
		</div>
	`;

	/* ==================== Event log + polling ==================== */

	const logEl = root.querySelector("#event-log");
	let lastEventId = 0;
	let firstLoad = true;

	const appendEvents = (events) => {
		if (firstLoad) {
			logEl.innerHTML = "";
			firstLoad = false;
		}
		if (!events.length && !logEl.children.length) {
			logEl.innerHTML = `<div class="tvn-empty">The first page is blank. Say something!</div>`;
			return;
		}
		if (events.length && logEl.querySelector(".tvn-empty")) logEl.innerHTML = "";
		for (const event of events) {
			logEl.insertAdjacentHTML("beforeend", eventHtml(event, myRole, myMember?.id));
		}
		if (events.length) logEl.scrollTop = logEl.scrollHeight;
	};

	const pPoll = async () => {
		try {
			const {events, lastId} = await TavernApi.pGetEvents(adventureId, lastEventId);
			lastEventId = lastId;
			appendEvents(events);
		} catch (e) {
			// Transient poll errors are non-fatal; surface only on first load
			if (firstLoad) {
				logEl.innerHTML = `<div class="tvn-empty">${esc(e.message)}</div>`;
				firstLoad = false;
			}
		}
	};

	await pPoll();
	pollTimer = setInterval(pPoll, POLL_INTERVAL_MS);

	logEl.addEventListener("click", async evt => {
		const link = evt.target.closest("[data-delete-event]");
		if (!link) return;
		evt.preventDefault();
		try {
			await TavernApi.pDeleteEvent(adventureId, Number(link.dataset.deleteEvent));
			link.closest(".tvn-event").remove();
		} catch (e) {
			toast(e.message, "danger");
		}
	});

	/* ==================== Composer ==================== */

	const typeEl = root.querySelector("#sel-type");
	const contentEl = root.querySelector("#input-content");
	const formulaEl = root.querySelector("#input-formula");
	const errorEl = root.querySelector("#composer-error");

	const _PLACEHOLDERS = {
		narration: "Describe the scene…",
		speech: "What does your character say?",
		action: "What do you do?",
		roll: "Label, e.g. Perception check (optional)",
		note: "A note for the record…",
		ooc: "Table talk…",
	};

	typeEl.addEventListener("change", () => {
		formulaEl.style.display = typeEl.value === "roll" ? "" : "none";
		contentEl.placeholder = _PLACEHOLDERS[typeEl.value] || "";
	});

	const pSend = async () => {
		errorEl.textContent = "";
		const type = typeEl.value;
		const content = contentEl.value.trim();
		let data = null;

		if (type === "roll") {
			const result = rollFormula(formulaEl.value);
			if (!result) {
				errorEl.textContent = "Enter a dice formula such as 1d20+5 or 2d6+1d4.";
				return;
			}
			data = result;
		} else if (!content) {
			return;
		}

		try {
			await TavernApi.pPostEvent(adventureId, {type, content, data});
			contentEl.value = "";
			await pPoll();
		} catch (e) {
			errorEl.textContent = e.message;
		}
	};

	root.querySelector("#btn-send").addEventListener("click", pSend);
	contentEl.addEventListener("keydown", evt => {
		if (evt.key === "Enter" && !evt.shiftKey) {
			evt.preventDefault();
			pSend();
		}
	});

	/* ==================== Side panel actions ==================== */

	root.querySelector("#btn-back").addEventListener("click", renderList);

	root.querySelector("#sel-my-char").addEventListener("change", async evt => {
		try {
			await TavernApi.pUpdateMyMembership(adventureId, {characterId: evt.target.value ? Number(evt.target.value) : null});
			toast("Character updated");
			renderAdventure(adventureId);
		} catch (e) {
			toast(e.message, "danger");
		}
	});

	root.querySelector("#sel-status")?.addEventListener("change", async evt => {
		try {
			await TavernApi.pUpdateAdventure(adventureId, {status: evt.target.value});
			toast(`Adventure is now ${evt.target.value}`);
		} catch (e) {
			toast(e.message, "danger");
		}
	});

	root.querySelector("#btn-leave")?.addEventListener("click", async () => {
		if (!confirm("Leave this party?")) return;
		try {
			await TavernApi.pRemoveMember(adventureId, myMember.id);
			renderList();
		} catch (e) {
			toast(e.message, "danger");
		}
	});

	root.querySelectorAll("[data-kick]").forEach(btn => {
		btn.addEventListener("click", async () => {
			if (!confirm("Remove this member from the party?")) return;
			try {
				await TavernApi.pRemoveMember(adventureId, Number(btn.dataset.kick));
				renderAdventure(adventureId);
			} catch (e) {
				toast(e.message, "danger");
			}
		});
	});
};

/* ==================== Init ==================== */

const init = async () => {
	currentUser = await pLoadUser();
	if (!currentUser) {
		renderHero(hero, {title: "Campaigns", subtitle: "Gather a party, and venture forth."});
		return renderSignInPrompt(root);
	}
	const match = location.hash.match(/^#\/a\/(\d+)$/);
	if (match) renderAdventure(Number(match[1]));
	else renderList();
};

window.addEventListener("hashchange", () => {
	const match = location.hash.match(/^#\/a\/(\d+)$/);
	if (!match) {
		stopPolling();
		if (currentUser) renderList();
	}
});

init();
