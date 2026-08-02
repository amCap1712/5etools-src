/**
 * API client for the Tavern backend (see `server/`).
 *
 * The API base URL is resolved as follows:
 *  - `localStorage["tavern:apiUrl"]` override, if set (e.g. "https://example.com/api");
 *  - `http://<host>:5000/api` when running from a local dev static server;
 *  - same-origin `/api` otherwise (i.e. the backend is reverse-proxied).
 */

const _DEV_STATIC_PORTS = new Set(["5050", "5051", "8080", "3000"]);

const _getApiBase = () => {
	const stored = window.localStorage.getItem("tavern:apiUrl");
	if (stored) return stored.replace(/\/+$/, "");
	if (location.protocol === "file:" || _DEV_STATIC_PORTS.has(location.port)) {
		return `http://${location.hostname || "localhost"}:5000/api`;
	}
	return "/api";
};

export const TavernApi = {
	BASE: _getApiBase(),

	getToken () { return window.localStorage.getItem("tavern:token"); },
	setToken (token) {
		if (token) window.localStorage.setItem("tavern:token", token);
		else window.localStorage.removeItem("tavern:token");
	},
	isLoggedIn () { return !!this.getToken(); },

	/** Resolve a server-relative URL (e.g. "/api/uploads/x.png") against the API host. */
	absUrl (url) {
		if (!url) return null;
		if (/^https?:/.test(url)) return url;
		if (this.BASE.startsWith("http")) {
			const origin = new URL(this.BASE).origin;
			return `${origin}${url}`;
		}
		return url;
	},

	async request (path, {method = "GET", body = null, formData = null} = {}) {
		const headers = {};
		const token = this.getToken();
		if (token) headers["Authorization"] = `Bearer ${token}`;
		if (body != null) headers["Content-Type"] = "application/json";

		let response;
		try {
			response = await fetch(`${this.BASE}${path}`, {
				method,
				headers,
				body: formData || (body != null ? JSON.stringify(body) : undefined),
			});
		} catch (e) {
			throw new Error(`Could not reach the Tavern server at ${this.BASE} — is it running? (see server/README.md)`);
		}

		let json = null;
		try { json = await response.json(); } catch (e) { /* non-JSON error body */ }

		if (!response.ok) {
			const err = new Error(json?.error || `Request failed (${response.status})`);
			err.status = response.status;
			throw err;
		}
		return json;
	},

	// ==================== Auth ====================
	pGetAuthConfig () { return this.request("/auth/config"); },
	pRegister (username, email, password) { return this.request("/auth/register", {method: "POST", body: {username, email, password}}); },
	pLogin (identifier, password) { return this.request("/auth/login", {method: "POST", body: {username: identifier, password}}); },
	pGoogleLogin (credential) { return this.request("/auth/google", {method: "POST", body: {credential}}); },
	pGetMe () { return this.request("/auth/me"); },
	pChangePassword (currentPassword, newPassword) { return this.request("/auth/password", {method: "POST", body: {currentPassword, newPassword}}); },

	// ==================== Profile ====================
	pUpdateProfile (fields) { return this.request("/profile", {method: "PUT", body: fields}); },
	pUploadAvatar (file) {
		const formData = new FormData();
		formData.append("file", file);
		return this.request("/profile/avatar", {method: "POST", formData});
	},

	// ==================== Characters ====================
	pGetCharacters () { return this.request("/characters"); },
	pGetCharacter (id) { return this.request(`/characters/${id}`); },
	pCreateCharacter (fields) { return this.request("/characters", {method: "POST", body: fields}); },
	pUpdateCharacter (id, fields) { return this.request(`/characters/${id}`, {method: "PUT", body: fields}); },
	pDeleteCharacter (id) { return this.request(`/characters/${id}`, {method: "DELETE"}); },
	pUploadPortrait (id, file) {
		const formData = new FormData();
		formData.append("file", file);
		return this.request(`/characters/${id}/portrait`, {method: "POST", formData});
	},

	// ==================== Adventures ====================
	pGetAdventures () { return this.request("/adventures"); },
	pGetAdventure (id) { return this.request(`/adventures/${id}`); },
	pCreateAdventure (fields) { return this.request("/adventures", {method: "POST", body: fields}); },
	pUpdateAdventure (id, fields) { return this.request(`/adventures/${id}`, {method: "PUT", body: fields}); },
	pJoinAdventure (code, characterId) { return this.request("/adventures/join", {method: "POST", body: {code, characterId}}); },
	pUpdateMyMembership (adventureId, fields) { return this.request(`/adventures/${adventureId}/members/me`, {method: "PUT", body: fields}); },
	pRemoveMember (adventureId, memberId) { return this.request(`/adventures/${adventureId}/members/${memberId}`, {method: "DELETE"}); },
	pGetEvents (adventureId, after = 0) { return this.request(`/adventures/${adventureId}/events?after=${after}`); },
	pPostEvent (adventureId, {type, content, data}) { return this.request(`/adventures/${adventureId}/events`, {method: "POST", body: {type, content, data}}); },
	pDeleteEvent (adventureId, eventId) { return this.request(`/adventures/${adventureId}/events/${eventId}`, {method: "DELETE"}); },
};
