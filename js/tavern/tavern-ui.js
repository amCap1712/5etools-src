/** Shared UI helpers for the Tavern pages. */

import {TavernApi} from "./tavern-api.js";

export const esc = (str) => `${str ?? ""}`
	.replace(/&/g, "&amp;")
	.replace(/</g, "&lt;")
	.replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;");

export const el = (tag, className = "", html = "") => {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (html) element.innerHTML = html;
	return element;
};

export const toast = (message, type = "info") => {
	let wrp = document.querySelector(".tvn-toast-wrp");
	if (!wrp) {
		wrp = el("div", "tvn-toast-wrp");
		document.body.appendChild(wrp);
	}
	const node = el("div", `tvn-toast${type === "danger" ? " tvn-toast--danger" : ""}`, esc(message));
	wrp.appendChild(node);
	setTimeout(() => node.remove(), 5000);
};

export const fmtDateTime = (iso) => {
	if (!iso) return "";
	try {
		return new Date(iso).toLocaleString(undefined, {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
	} catch (e) {
		return iso;
	}
};

export const abilityMod = (score) => {
	const n = Number(score);
	if (Number.isNaN(n)) return "+0";
	const mod = Math.floor((n - 10) / 2);
	return mod >= 0 ? `+${mod}` : `${mod}`;
};

export const proficiencyBonus = (level) => Math.ceil((Number(level) || 1) / 4) + 1;

/** Cryptographically-secure uniform integer in [0, maxExclusive), via rejection sampling. */
export const secureRandomInt = (maxExclusive) => {
	const buf = new Uint32Array(1);
	const limit = 4294967296 - (4294967296 % maxExclusive);
	do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
	return buf[0] % maxExclusive;
};

/**
 * Roll a dice formula like "2d6+1d4+3" or "1d20-1".
 * Returns {formula, rolls: [{die, results}], modifier, total} or null if invalid.
 */
export const rollFormula = (formula) => {
	const cleaned = `${formula || ""}`.replace(/\s+/g, "").toLowerCase();
	if (!cleaned || !/^[-+]?(\d*d\d+|\d+)([-+](\d*d\d+|\d+))*$/.test(cleaned)) return null;

	const terms = cleaned.match(/[-+]?[^-+]+/g) || [];
	const rolls = [];
	let modifier = 0;
	let total = 0;

	for (const term of terms) {
		const sign = term.startsWith("-") ? -1 : 1;
		const body = term.replace(/^[-+]/, "");
		if (body.includes("d")) {
			const [countRaw, sizeRaw] = body.split("d");
			const count = Math.min(Number(countRaw || 1), 100);
			const size = Math.min(Number(sizeRaw), 10000);
			if (!count || !size) return null;
			const results = [];
			for (let i = 0; i < count; ++i) {
				const r = secureRandomInt(size) + 1;
				results.push(r);
				total += sign * r;
			}
			rolls.push({die: `${sign < 0 ? "-" : ""}${count}d${size}`, results});
		} else {
			modifier += sign * Number(body);
			total += sign * Number(body);
		}
	}
	return {formula: cleaned, rolls, modifier, total};
};

export const avatarHtml = (url, name, sizeClass = "") => {
	const abs = TavernApi.absUrl(url);
	if (abs) return `<img class="tvn-avatar ${sizeClass}" src="${esc(abs)}" alt="${esc(name)}">`;
	const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
	return `<span class="tvn-avatar tvn-avatar--placeholder ${sizeClass}">${esc(initial)}</span>`;
};

const _NAV_LINKS = [
	{href: "account.html", label: "Account"},
	{href: "mycharacters.html", label: "My Characters"},
	{href: "campaigns.html", label: "Campaigns"},
];

/** Render the hero banner + tavern sub-nav into `container`. */
export const renderHero = (container, {title, subtitle, user = null}) => {
	const currentPage = location.pathname.split("/").pop() || "account.html";
	const links = _NAV_LINKS
		.map(it => `<a class="tvn-nav__link${it.href === currentPage ? " tvn-nav__link--active" : ""}" href="${it.href}">${it.label}</a>`)
		.join("");

	const profile = user?.profile;
	const userHtml = user
		? `<span class="tvn-nav__user">${avatarHtml(profile?.avatarUrl, profile?.displayName || user.username, "tvn-avatar--sm")} ${esc(profile?.displayName || user.username)}</span>`
		: `<span class="tvn-nav__user"><a class="tvn-nav__link" href="account.html">Sign In</a></span>`;

	container.innerHTML = `
		<p class="tvn-hero__eyebrow">The Tavern</p>
		<h1 class="tvn-hero__title">${esc(title)}</h1>
		<p class="tvn-hero__subtitle">${esc(subtitle)}</p>
		<nav class="tvn-nav">${links}${userHtml}</nav>
	`;
};

/**
 * Load the current user, or null when logged out / token expired.
 * Clears the stored token on a 401.
 */
export const pLoadUser = async () => {
	if (!TavernApi.isLoggedIn()) return null;
	try {
		const {user} = await TavernApi.pGetMe();
		return user;
	} catch (e) {
		if (e.status === 401) TavernApi.setToken(null);
		else toast(e.message, "danger");
		return null;
	}
};

/** Render a "sign in first" card for pages that need auth. */
export const renderSignInPrompt = (container) => {
	container.innerHTML = `
		<div class="tvn-card tvn-card--corners" style="max-width: 460px; margin: 30px auto; text-align: center;">
			<h2 class="tvn-card__title">The doors are barred</h2>
			<p class="tvn-card__hint">You must be signed in to enter this part of the tavern.</p>
			<a class="tvn-btn" href="account.html">Sign in or create an account</a>
		</div>
	`;
};
