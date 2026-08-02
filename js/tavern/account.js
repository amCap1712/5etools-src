/** Account page: sign in / register / Google Sign-In, and profile editing. */

import {TavernApi} from "./tavern-api.js";
import {avatarHtml, el, esc, pLoadUser, renderHero, toast} from "./tavern-ui.js";

const hero = document.getElementById("tvn-hero");
const root = document.getElementById("tvn-root");

let googleClientId = null;

/* ==================== Logged-out view ==================== */

const renderAuth = () => {
	renderHero(hero, {
		title: "Welcome, Traveler",
		subtitle: "Sign in to manage your profile, forge characters, and gather a party for adventure.",
	});

	root.innerHTML = `
		<div class="tvn-card tvn-card--corners" style="max-width: 460px; margin: 10px auto;">
			<div class="tvn-tabs">
				<button class="tvn-tab tvn-tab--active" data-tab="login">Sign In</button>
				<button class="tvn-tab" data-tab="register">Create Account</button>
			</div>

			<form id="form-login">
				<div class="tvn-field">
					<label class="tvn-label">Username or Email</label>
					<input class="tvn-input" name="identifier" required autocomplete="username">
				</div>
				<div class="tvn-field">
					<label class="tvn-label">Password</label>
					<input class="tvn-input" type="password" name="password" required autocomplete="current-password">
				</div>
				<button class="tvn-btn tvn-w-100" type="submit">Enter the Tavern</button>
			</form>

			<form id="form-register" style="display: none;">
				<div class="tvn-field">
					<label class="tvn-label">Username</label>
					<input class="tvn-input" name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_\\-]+" autocomplete="username">
				</div>
				<div class="tvn-field">
					<label class="tvn-label">Email</label>
					<input class="tvn-input" type="email" name="email" required autocomplete="email">
				</div>
				<div class="tvn-field">
					<label class="tvn-label">Password <span class="tvn-muted">(8+ characters)</span></label>
					<input class="tvn-input" type="password" name="password" required minlength="8" autocomplete="new-password">
				</div>
				<button class="tvn-btn tvn-w-100" type="submit">Sign the Guestbook</button>
			</form>

			<p class="tvn-error" id="auth-error"></p>

			<div id="google-section" style="display: none;">
				<hr class="tvn-rule tvn-rule--fancy">
				<div id="google-btn" style="display: flex; justify-content: center;"></div>
			</div>
		</div>
	`;

	const errorEl = root.querySelector("#auth-error");
	const forms = {login: root.querySelector("#form-login"), register: root.querySelector("#form-register")};

	root.querySelectorAll(".tvn-tab").forEach(tab => {
		tab.addEventListener("click", () => {
			root.querySelectorAll(".tvn-tab").forEach(t => t.classList.toggle("tvn-tab--active", t === tab));
			Object.entries(forms).forEach(([name, form]) => form.style.display = name === tab.dataset.tab ? "" : "none");
			errorEl.textContent = "";
		});
	});

	forms.login.addEventListener("submit", async evt => {
		evt.preventDefault();
		errorEl.textContent = "";
		const data = new FormData(forms.login);
		try {
			const out = await TavernApi.pLogin(data.get("identifier"), data.get("password"));
			TavernApi.setToken(out.token);
			renderProfile(out.user);
		} catch (e) {
			errorEl.textContent = e.message;
		}
	});

	forms.register.addEventListener("submit", async evt => {
		evt.preventDefault();
		errorEl.textContent = "";
		const data = new FormData(forms.register);
		try {
			const out = await TavernApi.pRegister(data.get("username"), data.get("email"), data.get("password"));
			TavernApi.setToken(out.token);
			toast("Welcome to the Tavern!");
			renderProfile(out.user);
		} catch (e) {
			errorEl.textContent = e.message;
		}
	});

	if (googleClientId) initGoogleButton(errorEl);
};

const initGoogleButton = (errorEl) => {
	const section = root.querySelector("#google-section");
	const target = root.querySelector("#google-btn");
	if (!section || !target) return;
	section.style.display = "";

	const onReady = () => {
		window.google.accounts.id.initialize({
			client_id: googleClientId,
			callback: async ({credential}) => {
				try {
					const out = await TavernApi.pGoogleLogin(credential);
					TavernApi.setToken(out.token);
					renderProfile(out.user);
				} catch (e) {
					errorEl.textContent = e.message;
				}
			},
		});
		window.google.accounts.id.renderButton(target, {theme: "outline", size: "large", width: 280});
	};

	if (window.google?.accounts?.id) return onReady();
	const script = document.createElement("script");
	script.src = "https://accounts.google.com/gsi/client";
	script.async = true;
	script.onload = onReady;
	document.head.appendChild(script);
};

/* ==================== Logged-in view ==================== */

const renderProfile = (user) => {
	const profile = user.profile || {};
	renderHero(hero, {
		title: profile.displayName || user.username,
		subtitle: "Your corner of the tavern. Adjust your likeness and legend below.",
		user,
	});

	root.innerHTML = `
		<div class="tvn-grid" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));">
			<div class="tvn-card tvn-card--corners">
				<h2 class="tvn-card__title">Profile</h2>
				<p class="tvn-card__hint">This is how other adventurers see you.</p>

				<div style="display: flex; align-items: center; gap: 14px; margin-bottom: 14px;">
					<span id="avatar-slot">${avatarHtml(profile.avatarUrl, profile.displayName || user.username, "tvn-avatar--lg")}</span>
					<div>
						<label class="tvn-btn tvn-btn--ghost tvn-btn--sm" for="avatar-file">Change portrait</label>
						<input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" style="display: none;">
						<div class="tvn-muted" style="font-size: 11px; margin-top: 4px;">PNG/JPG/WebP/GIF, up to 5 MB</div>
					</div>
				</div>

				<form id="form-profile">
					<div class="tvn-form-row">
						<div class="tvn-field">
							<label class="tvn-label">Display Name</label>
							<input class="tvn-input" name="displayName" maxlength="64" value="${esc(profile.displayName || "")}">
						</div>
						<div class="tvn-field">
							<label class="tvn-label">Pronouns</label>
							<input class="tvn-input" name="pronouns" maxlength="32" value="${esc(profile.pronouns || "")}">
						</div>
					</div>
					<div class="tvn-form-row">
						<div class="tvn-field">
							<label class="tvn-label">Location</label>
							<input class="tvn-input" name="location" maxlength="64" value="${esc(profile.location || "")}">
						</div>
						<div class="tvn-field">
							<label class="tvn-label">Website</label>
							<input class="tvn-input" name="website" maxlength="255" value="${esc(profile.website || "")}">
						</div>
					</div>
					<div class="tvn-field">
						<label class="tvn-label">Bio</label>
						<textarea class="tvn-textarea" name="bio" maxlength="4000" placeholder="A hero's tale, or a humble scribble…">${esc(profile.bio || "")}</textarea>
					</div>
					<button class="tvn-btn" type="submit">Save Profile</button>
					<p class="tvn-error" id="profile-error"></p>
				</form>
			</div>

			<div class="tvn-card tvn-card--corners">
				<h2 class="tvn-card__title">Account</h2>
				<p class="tvn-card__hint">Credentials and connections.</p>

				<div class="tvn-field"><span class="tvn-label">Username</span>${esc(user.username)}</div>
				<div class="tvn-field"><span class="tvn-label">Email</span>${esc(user.email)}</div>
				<div class="tvn-field">
					<span class="tvn-label">Sign-in methods</span>
					${user.hasPassword ? `<span class="tvn-badge tvn-badge--gold">Password</span>` : ""}
					${user.hasGoogle ? `<span class="tvn-badge tvn-badge--gold">Google</span>` : ""}
				</div>

				<hr class="tvn-rule">

				<h3 class="tvn-section-title tvn-mt-0">${user.hasPassword ? "Change Password" : "Set a Password"}</h3>
				<form id="form-password">
					${user.hasPassword ? `
					<div class="tvn-field">
						<label class="tvn-label">Current Password</label>
						<input class="tvn-input" type="password" name="currentPassword" autocomplete="current-password">
					</div>` : ""}
					<div class="tvn-field">
						<label class="tvn-label">New Password</label>
						<input class="tvn-input" type="password" name="newPassword" required minlength="8" autocomplete="new-password">
					</div>
					<button class="tvn-btn tvn-btn--ghost" type="submit">Update Password</button>
					<p class="tvn-error" id="password-error"></p>
				</form>

				<hr class="tvn-rule">
				<button class="tvn-btn tvn-btn--danger" id="btn-logout">Sign Out</button>
			</div>
		</div>
	`;

	root.querySelector("#form-profile").addEventListener("submit", async evt => {
		evt.preventDefault();
		const errorEl = root.querySelector("#profile-error");
		errorEl.textContent = "";
		const data = new FormData(evt.target);
		try {
			await TavernApi.pUpdateProfile({
				displayName: data.get("displayName"),
				pronouns: data.get("pronouns"),
				location: data.get("location"),
				website: data.get("website"),
				bio: data.get("bio"),
			});
			toast("Profile saved");
			const {user: fresh} = await TavernApi.pGetMe();
			renderProfile(fresh);
		} catch (e) {
			errorEl.textContent = e.message;
		}
	});

	root.querySelector("#avatar-file").addEventListener("change", async evt => {
		const file = evt.target.files[0];
		if (!file) return;
		try {
			const {profile: fresh} = await TavernApi.pUploadAvatar(file);
			root.querySelector("#avatar-slot").innerHTML = avatarHtml(fresh.avatarUrl, fresh.displayName || user.username, "tvn-avatar--lg");
			toast("Portrait updated");
		} catch (e) {
			toast(e.message, "danger");
		}
	});

	root.querySelector("#form-password").addEventListener("submit", async evt => {
		evt.preventDefault();
		const errorEl = root.querySelector("#password-error");
		errorEl.textContent = "";
		const data = new FormData(evt.target);
		try {
			await TavernApi.pChangePassword(data.get("currentPassword") || "", data.get("newPassword"));
			toast("Password updated");
			evt.target.reset();
		} catch (e) {
			errorEl.textContent = e.message;
		}
	});

	root.querySelector("#btn-logout").addEventListener("click", () => {
		TavernApi.setToken(null);
		toast("Farewell, traveler");
		renderAuth();
	});
};

/* ==================== Init ==================== */

const init = async () => {
	try {
		({googleClientId} = await TavernApi.pGetAuthConfig());
	} catch (e) {
		root.innerHTML = "";
		root.appendChild(el("div", "tvn-card tvn-empty", esc(e.message)));
		renderHero(hero, {title: "Welcome, Traveler", subtitle: "The tavern keeper is not answering."});
		return;
	}

	const user = await pLoadUser();
	if (user) renderProfile(user);
	else renderAuth();
};

init();
