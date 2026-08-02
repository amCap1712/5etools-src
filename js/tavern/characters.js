/** My Characters page: roster of the player's characters and a full sheet editor. */

import {TavernApi} from "./tavern-api.js";
import {abilityMod, avatarHtml, esc, pLoadUser, proficiencyBonus, renderHero, renderSignInPrompt, toast} from "./tavern-ui.js";

const hero = document.getElementById("tvn-hero");
const root = document.getElementById("tvn-root");

let currentUser = null;

const ABILITIES = [
	["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"],
	["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"],
];

const SKILLS = [
	["Acrobatics", "dex"], ["Animal Handling", "wis"], ["Arcana", "int"], ["Athletics", "str"],
	["Deception", "cha"], ["History", "int"], ["Insight", "wis"], ["Intimidation", "cha"],
	["Investigation", "int"], ["Medicine", "wis"], ["Nature", "int"], ["Perception", "wis"],
	["Performance", "cha"], ["Persuasion", "cha"], ["Religion", "int"], ["Sleight of Hand", "dex"],
	["Stealth", "dex"], ["Survival", "wis"],
];

const ALIGNMENTS = [
	"Lawful Good", "Neutral Good", "Chaotic Good",
	"Lawful Neutral", "True Neutral", "Chaotic Neutral",
	"Lawful Evil", "Neutral Evil", "Chaotic Evil", "Unaligned",
];

const PERSONA_FIELDS = [
	["traits", "Personality Traits"], ["ideals", "Ideals"], ["bonds", "Bonds"], ["flaws", "Flaws"],
	["appearance", "Appearance"], ["backstory", "Backstory"], ["allies", "Allies & Organizations"], ["notes", "Notes"],
];

/* ==================== Roster ==================== */

const renderRoster = async () => {
	location.hash = "";
	renderHero(hero, {
		title: "My Characters",
		subtitle: "Every hero needs a beginning. Forge a new character, or continue an old tale.",
		user: currentUser,
	});
	root.innerHTML = `<div class="tvn-loading">Consulting the rosters</div>`;

	let characters;
	try {
		({characters} = await TavernApi.pGetCharacters());
	} catch (e) {
		root.innerHTML = `<div class="tvn-card tvn-empty">${esc(e.message)}</div>`;
		return;
	}

	const cards = characters.map(c => `
		<div class="tvn-card tvn-card--corners tvn-char-card" data-id="${c.id}">
			<div class="tvn-char-card__head">
				${avatarHtml(c.portraitUrl, c.name)}
				<div>
					<h3 class="tvn-char-card__name">${esc(c.name)}</h3>
					<div class="tvn-char-card__meta">
						Level ${c.level} ${esc(c.race || "")} ${esc(c.className || "Adventurer")}
						${c.isRetired ? `<span class="tvn-badge tvn-badge--muted">Retired</span>` : ""}
					</div>
				</div>
			</div>
		</div>
	`).join("");

	root.innerHTML = `
		<div class="tvn-grid">
			${cards}
			<button class="tvn-card tvn-new-card" id="btn-new">✦ Forge a New Character</button>
		</div>
	`;

	root.querySelectorAll(".tvn-char-card").forEach(card => {
		card.addEventListener("click", () => renderEditor(Number(card.dataset.id)));
	});

	root.querySelector("#btn-new").addEventListener("click", async () => {
		const name = prompt("Name your new character:");
		if (!name || !name.trim()) return;
		try {
			const {character} = await TavernApi.pCreateCharacter({name: name.trim(), sheet: {}});
			renderEditor(character.id);
		} catch (e) {
			toast(e.message, "danger");
		}
	});
};

/* ==================== Sheet editor ==================== */

const _num = (v) => v === "" || v == null ? null : Number(v);

const renderEditor = async (characterId) => {
	location.hash = `#/c/${characterId}`;
	root.innerHTML = `<div class="tvn-loading">Unfurling the sheet</div>`;

	let character;
	try {
		({character} = await TavernApi.pGetCharacter(characterId));
	} catch (e) {
		toast(e.message, "danger");
		return renderRoster();
	}

	const sheet = character.sheet || {};
	const abilities = sheet.abilities || {};
	const combat = sheet.combat || {};
	const profs = sheet.proficiencies || {};
	const spellcasting = sheet.spellcasting || {};
	const equipment = sheet.equipment || {};
	const coins = equipment.coins || {};
	const persona = sheet.persona || {};

	renderHero(hero, {
		title: character.name,
		subtitle: `Level ${character.level} ${character.race || ""} ${character.className || "Adventurer"}`.replace(/\s+/g, " "),
		user: currentUser,
	});

	const abilityTiles = ABILITIES.map(([key, label]) => `
		<div class="tvn-ability">
			<div class="tvn-ability__label">${label.slice(0, 3)}</div>
			<div class="tvn-ability__mod" data-mod-for="${key}">${abilityMod(abilities[key] ?? 10)}</div>
			<input class="tvn-input tvn-ability__score" type="number" min="1" max="30" name="ability-${key}" value="${abilities[key] ?? 10}">
		</div>
	`).join("");

	const saveChecks = ABILITIES.map(([key, label]) => `
		<label class="tvn-check"><input type="checkbox" name="save-${key}" ${(profs.saves || []).includes(key) ? "checked" : ""}> ${label}</label>
	`).join("");

	const skillChecks = SKILLS.map(([skill, ability]) => `
		<label class="tvn-check"><input type="checkbox" name="skill" value="${esc(skill)}" ${(profs.skills || []).includes(skill) ? "checked" : ""}> ${skill} <span class="tvn-muted">(${ability})</span></label>
	`).join("");

	const personaFields = PERSONA_FIELDS.map(([key, label]) => `
		<div class="tvn-field">
			<label class="tvn-label">${label}</label>
			<textarea class="tvn-textarea" name="persona-${key}">${esc(persona[key] || "")}</textarea>
		</div>
	`).join("");

	root.innerHTML = `
		<div class="tvn-flex-between" style="margin-bottom: 12px;">
			<button class="tvn-btn tvn-btn--ghost tvn-btn--sm" id="btn-back">← All characters</button>
			<div>
				<label class="tvn-btn tvn-btn--ghost tvn-btn--sm" for="portrait-file">Portrait</label>
				<input type="file" id="portrait-file" accept="image/png,image/jpeg,image/webp,image/gif" style="display: none;">
				<button class="tvn-btn tvn-btn--danger tvn-btn--sm" id="btn-delete">Delete</button>
			</div>
		</div>

		<form id="form-sheet">
		<div class="tvn-card tvn-card--corners">
			<h2 class="tvn-section-title tvn-mt-0">Identity</h2>
			<div class="tvn-form-row">
				<div class="tvn-field"><label class="tvn-label">Name</label><input class="tvn-input" name="name" required maxlength="128" value="${esc(character.name)}"></div>
				<div class="tvn-field"><label class="tvn-label">Species / Race</label><input class="tvn-input" name="race" maxlength="64" value="${esc(character.race || "")}"></div>
				<div class="tvn-field"><label class="tvn-label">Class</label><input class="tvn-input" name="className" maxlength="64" value="${esc(character.className || "")}"></div>
				<div class="tvn-field"><label class="tvn-label">Subclass</label><input class="tvn-input" name="subclass" maxlength="64" value="${esc(sheet.subclass || "")}"></div>
			</div>
			<div class="tvn-form-row">
				<div class="tvn-field"><label class="tvn-label">Level</label><input class="tvn-input" type="number" name="level" min="1" max="20" value="${character.level}"></div>
				<div class="tvn-field"><label class="tvn-label">XP</label><input class="tvn-input" type="number" name="xp" min="0" value="${sheet.xp ?? ""}"></div>
				<div class="tvn-field"><label class="tvn-label">Background</label><input class="tvn-input" name="background" maxlength="64" value="${esc(sheet.background || "")}"></div>
				<div class="tvn-field">
					<label class="tvn-label">Alignment</label>
					<select class="tvn-select" name="alignment">
						<option value="">—</option>
						${ALIGNMENTS.map(a => `<option ${sheet.alignment === a ? "selected" : ""}>${a}</option>`).join("")}
					</select>
				</div>
			</div>
			<label class="tvn-check"><input type="checkbox" name="isRetired" ${character.isRetired ? "checked" : ""}> Retired (hidden from adventure character pickers)</label>

			<hr class="tvn-rule tvn-rule--fancy">

			<h2 class="tvn-section-title">Abilities <span class="tvn-muted" style="text-transform: none; letter-spacing: 0;">— proficiency bonus <b id="prof-bonus">+${proficiencyBonus(character.level)}</b></span></h2>
			<div class="tvn-ability-row">${abilityTiles}</div>

			<h2 class="tvn-section-title">Combat</h2>
			<div class="tvn-form-row">
				<div class="tvn-field"><label class="tvn-label">Armor Class</label><input class="tvn-input" type="number" name="ac" value="${combat.ac ?? ""}"></div>
				<div class="tvn-field"><label class="tvn-label">Initiative Bonus</label><input class="tvn-input" type="number" name="initiativeBonus" value="${combat.initiativeBonus ?? ""}"></div>
				<div class="tvn-field"><label class="tvn-label">Speed</label><input class="tvn-input" name="speed" maxlength="64" value="${esc(combat.speed || "")}" placeholder="30 ft."></div>
				<div class="tvn-field"><label class="tvn-label">Hit Dice</label><input class="tvn-input" name="hitDice" maxlength="32" value="${esc(combat.hitDice || "")}" placeholder="3d8"></div>
			</div>
			<div class="tvn-form-row">
				<div class="tvn-field"><label class="tvn-label">Max HP</label><input class="tvn-input" type="number" name="hpMax" value="${combat.hpMax ?? ""}"></div>
				<div class="tvn-field"><label class="tvn-label">Current HP</label><input class="tvn-input" type="number" name="hpCurrent" value="${combat.hpCurrent ?? ""}"></div>
				<div class="tvn-field"><label class="tvn-label">Temp HP</label><input class="tvn-input" type="number" name="hpTemp" value="${combat.hpTemp ?? ""}"></div>
			</div>

			<h2 class="tvn-section-title">Saving Throws</h2>
			<div>${saveChecks}</div>

			<h2 class="tvn-section-title">Skill Proficiencies</h2>
			<div>${skillChecks}</div>

			<div class="tvn-form-row" style="margin-top: 10px;">
				<div class="tvn-field"><label class="tvn-label">Languages</label><input class="tvn-input" name="languages" value="${esc(profs.languages || "")}" placeholder="Common, Elvish…"></div>
				<div class="tvn-field"><label class="tvn-label">Tools & Other Proficiencies</label><input class="tvn-input" name="tools" value="${esc(profs.tools || "")}"></div>
			</div>

			<hr class="tvn-rule tvn-rule--fancy">

			<h2 class="tvn-section-title">Spellcasting</h2>
			<div class="tvn-form-row">
				<div class="tvn-field">
					<label class="tvn-label">Casting Ability</label>
					<select class="tvn-select" name="castingAbility">
						<option value="">—</option>
						${ABILITIES.map(([key, label]) => `<option value="${key}" ${spellcasting.ability === key ? "selected" : ""}>${label}</option>`).join("")}
					</select>
				</div>
				<div class="tvn-field"><label class="tvn-label">Spell Save DC</label><input class="tvn-input" type="number" name="saveDc" value="${spellcasting.saveDc ?? ""}"></div>
				<div class="tvn-field"><label class="tvn-label">Spell Attack Bonus</label><input class="tvn-input" type="number" name="attackBonus" value="${spellcasting.attackBonus ?? ""}"></div>
				<div class="tvn-field"><label class="tvn-label">Spell Slots</label><input class="tvn-input" name="slots" value="${esc(spellcasting.slots || "")}" placeholder="4 / 3 / 2"></div>
			</div>
			<div class="tvn-field">
				<label class="tvn-label">Spells Known / Prepared <span class="tvn-muted">(one per line)</span></label>
				<textarea class="tvn-textarea" name="spells" rows="4">${esc(spellcasting.spells || "")}</textarea>
			</div>

			<h2 class="tvn-section-title">Equipment</h2>
			<div class="tvn-field">
				<label class="tvn-label">Items <span class="tvn-muted">(one per line)</span></label>
				<textarea class="tvn-textarea" name="items" rows="4">${esc(equipment.items || "")}</textarea>
			</div>
			<div class="tvn-form-row">
				${["cp", "sp", "ep", "gp", "pp"].map(coin => `
					<div class="tvn-field"><label class="tvn-label">${coin.toUpperCase()}</label><input class="tvn-input" type="number" min="0" name="coin-${coin}" value="${coins[coin] ?? ""}"></div>
				`).join("")}
			</div>

			<hr class="tvn-rule tvn-rule--fancy">

			<h2 class="tvn-section-title">Persona</h2>
			${personaFields}

			<button class="tvn-btn" type="submit">Save Character</button>
			<p class="tvn-error" id="sheet-error"></p>
		</div>
		</form>
	`;

	// Live ability modifier + proficiency bonus updates
	ABILITIES.forEach(([key]) => {
		const input = root.querySelector(`[name="ability-${key}"]`);
		input.addEventListener("input", () => {
			root.querySelector(`[data-mod-for="${key}"]`).textContent = abilityMod(input.value);
		});
	});
	root.querySelector(`[name="level"]`).addEventListener("input", evt => {
		root.querySelector("#prof-bonus").textContent = `+${proficiencyBonus(evt.target.value)}`;
	});

	root.querySelector("#btn-back").addEventListener("click", renderRoster);

	root.querySelector("#portrait-file").addEventListener("change", async evt => {
		const file = evt.target.files[0];
		if (!file) return;
		try {
			await TavernApi.pUploadPortrait(characterId, file);
			toast("Portrait updated");
		} catch (e) {
			toast(e.message, "danger");
		}
	});

	root.querySelector("#btn-delete").addEventListener("click", async () => {
		if (!confirm(`Strike ${character.name} from the record? This cannot be undone.`)) return;
		try {
			await TavernApi.pDeleteCharacter(characterId);
			toast("Character deleted");
			renderRoster();
		} catch (e) {
			toast(e.message, "danger");
		}
	});

	root.querySelector("#form-sheet").addEventListener("submit", async evt => {
		evt.preventDefault();
		const errorEl = root.querySelector("#sheet-error");
		errorEl.textContent = "";
		const data = new FormData(evt.target);

		const nextSheet = {
			...sheet,
			subclass: data.get("subclass") || null,
			background: data.get("background") || null,
			alignment: data.get("alignment") || null,
			xp: _num(data.get("xp")),
			abilities: Object.fromEntries(ABILITIES.map(([key]) => [key, _num(data.get(`ability-${key}`)) ?? 10])),
			combat: {
				ac: _num(data.get("ac")),
				initiativeBonus: _num(data.get("initiativeBonus")),
				speed: data.get("speed") || null,
				hitDice: data.get("hitDice") || null,
				hpMax: _num(data.get("hpMax")),
				hpCurrent: _num(data.get("hpCurrent")),
				hpTemp: _num(data.get("hpTemp")),
			},
			proficiencies: {
				saves: ABILITIES.map(([key]) => key).filter(key => data.get(`save-${key}`)),
				skills: data.getAll("skill"),
				languages: data.get("languages") || null,
				tools: data.get("tools") || null,
			},
			spellcasting: {
				ability: data.get("castingAbility") || null,
				saveDc: _num(data.get("saveDc")),
				attackBonus: _num(data.get("attackBonus")),
				slots: data.get("slots") || null,
				spells: data.get("spells") || null,
			},
			equipment: {
				items: data.get("items") || null,
				coins: Object.fromEntries(["cp", "sp", "ep", "gp", "pp"].map(coin => [coin, _num(data.get(`coin-${coin}`)) ?? 0])),
			},
			persona: Object.fromEntries(PERSONA_FIELDS.map(([key]) => [key, data.get(`persona-${key}`) || null])),
		};

		try {
			await TavernApi.pUpdateCharacter(characterId, {
				name: data.get("name"),
				race: data.get("race"),
				className: data.get("className"),
				level: _num(data.get("level")) ?? 1,
				isRetired: !!data.get("isRetired"),
				sheet: nextSheet,
			});
			toast("Character saved");
			renderEditor(characterId);
		} catch (e) {
			errorEl.textContent = e.message;
		}
	});
};

/* ==================== Init ==================== */

const init = async () => {
	currentUser = await pLoadUser();
	if (!currentUser) {
		renderHero(hero, {title: "My Characters", subtitle: "Forge heroes; keep their legends close."});
		return renderSignInPrompt(root);
	}
	const match = location.hash.match(/^#\/c\/(\d+)$/);
	if (match) renderEditor(Number(match[1]));
	else renderRoster();
};

init();
