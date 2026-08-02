from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import JSONB

from .extensions import db

# JSONB on Postgres, plain JSON elsewhere (e.g. the SQLite dev fallback)
JsonCol = db.JSON().with_variant(JSONB(), "postgresql")

ADVENTURE_STATUSES = ("recruiting", "active", "completed", "archived")
MEMBER_ROLES = ("dm", "player")
# "system" events are generated server-side only (joins, leaves, etc.)
EVENT_TYPES = ("narration", "action", "speech", "roll", "ooc", "note", "system")
DM_ONLY_EVENT_TYPES = ("narration", "note")


def utcnow():
	return datetime.now(timezone.utc)


def _iso(dt):
	if dt is None:
		return None
	if dt.tzinfo is None:
		dt = dt.replace(tzinfo=timezone.utc)
	return dt.isoformat()


class User(db.Model):
	__tablename__ = "users"

	id = db.Column(db.Integer, primary_key=True)
	username = db.Column(db.String(32), unique=True, nullable=False, index=True)
	email = db.Column(db.String(255), unique=True, nullable=False, index=True)
	password_hash = db.Column(db.String(255), nullable=True)
	google_sub = db.Column(db.String(64), unique=True, nullable=True, index=True)
	created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

	profile = db.relationship("Profile", uselist=False, back_populates="user", cascade="all, delete-orphan")
	characters = db.relationship("Character", back_populates="owner", cascade="all, delete-orphan")
	memberships = db.relationship("AdventureMember", back_populates="user", cascade="all, delete-orphan")

	def to_dict(self):
		return {
			"id": self.id,
			"username": self.username,
			"email": self.email,
			"hasPassword": self.password_hash is not None,
			"hasGoogle": self.google_sub is not None,
			"createdAt": _iso(self.created_at),
			"profile": self.profile.to_dict() if self.profile else None,
		}


class Profile(db.Model):
	__tablename__ = "profiles"

	user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
	display_name = db.Column(db.String(64), nullable=True)
	bio = db.Column(db.Text, nullable=True)
	pronouns = db.Column(db.String(32), nullable=True)
	location = db.Column(db.String(64), nullable=True)
	website = db.Column(db.String(255), nullable=True)
	avatar_path = db.Column(db.String(255), nullable=True)
	extra = db.Column(JsonCol, nullable=True)
	updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

	user = db.relationship("User", back_populates="profile")

	def to_dict(self):
		return {
			"userId": self.user_id,
			"displayName": self.display_name,
			"bio": self.bio,
			"pronouns": self.pronouns,
			"location": self.location,
			"website": self.website,
			"avatarUrl": f"/api/uploads/{self.avatar_path}" if self.avatar_path else None,
			"extra": self.extra or {},
			"updatedAt": _iso(self.updated_at),
		}


class Character(db.Model):
	__tablename__ = "characters"

	id = db.Column(db.Integer, primary_key=True)
	user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
	name = db.Column(db.String(128), nullable=False)
	race = db.Column(db.String(64), nullable=True)
	char_class = db.Column("class", db.String(64), nullable=True)
	level = db.Column(db.Integer, nullable=False, default=1)
	portrait_path = db.Column(db.String(255), nullable=True)
	# Full character sheet; free-form so the character can be customized in
	# every way. Rules validation is planned as a later phase.
	sheet = db.Column(JsonCol, nullable=False, default=dict)
	is_retired = db.Column(db.Boolean, nullable=False, default=False)
	created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
	updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

	owner = db.relationship("User", back_populates="characters")

	def to_dict(self, summary=False):
		out = {
			"id": self.id,
			"ownerId": self.user_id,
			"name": self.name,
			"race": self.race,
			"className": self.char_class,
			"level": self.level,
			"portraitUrl": f"/api/uploads/{self.portrait_path}" if self.portrait_path else None,
			"isRetired": self.is_retired,
			"createdAt": _iso(self.created_at),
			"updatedAt": _iso(self.updated_at),
		}
		if not summary:
			out["sheet"] = self.sheet or {}
		return out


class Adventure(db.Model):
	__tablename__ = "adventures"

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False)
	description = db.Column(db.Text, nullable=True)
	status = db.Column(db.String(16), nullable=False, default="recruiting")
	join_code = db.Column(db.String(12), unique=True, nullable=False, index=True)
	created_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
	settings = db.Column(JsonCol, nullable=True)
	created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
	updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

	members = db.relationship("AdventureMember", back_populates="adventure", cascade="all, delete-orphan")
	events = db.relationship("AdventureEvent", back_populates="adventure", cascade="all, delete-orphan")

	def to_dict(self, include_code=False, include_members=False, role=None):
		out = {
			"id": self.id,
			"name": self.name,
			"description": self.description,
			"status": self.status,
			"createdBy": self.created_by,
			"settings": self.settings or {},
			"createdAt": _iso(self.created_at),
			"memberCount": len(self.members),
		}
		if role is not None:
			out["myRole"] = role
		if include_code:
			out["joinCode"] = self.join_code
		if include_members:
			out["members"] = [m.to_dict() for m in self.members]
		return out


class AdventureMember(db.Model):
	__tablename__ = "adventure_members"
	__table_args__ = (db.UniqueConstraint("adventure_id", "user_id", name="uq_adventure_user"),)

	id = db.Column(db.Integer, primary_key=True)
	adventure_id = db.Column(db.Integer, db.ForeignKey("adventures.id", ondelete="CASCADE"), nullable=False, index=True)
	user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
	role = db.Column(db.String(8), nullable=False, default="player")
	character_id = db.Column(db.Integer, db.ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)
	joined_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

	adventure = db.relationship("Adventure", back_populates="members")
	user = db.relationship("User", back_populates="memberships")
	character = db.relationship("Character")

	def display_name(self):
		if self.user and self.user.profile and self.user.profile.display_name:
			return self.user.profile.display_name
		return self.user.username if self.user else "Unknown"

	def to_dict(self):
		profile = self.user.profile if self.user else None
		return {
			"id": self.id,
			"userId": self.user_id,
			"username": self.user.username if self.user else None,
			"displayName": self.display_name(),
			"avatarUrl": profile.to_dict()["avatarUrl"] if profile else None,
			"role": self.role,
			"character": self.character.to_dict(summary=True) if self.character else None,
			"joinedAt": _iso(self.joined_at),
		}


class AdventureEvent(db.Model):
	__tablename__ = "adventure_events"
	__table_args__ = (db.Index("ix_events_adventure_id_id", "adventure_id", "id"),)

	id = db.Column(db.Integer, primary_key=True)
	adventure_id = db.Column(db.Integer, db.ForeignKey("adventures.id", ondelete="CASCADE"), nullable=False)
	member_id = db.Column(db.Integer, db.ForeignKey("adventure_members.id", ondelete="SET NULL"), nullable=True)
	# Snapshots, so the log stays intact if the member/character later changes
	author_name = db.Column(db.String(64), nullable=True)
	character_name = db.Column(db.String(128), nullable=True)
	type = db.Column(db.String(16), nullable=False)
	content = db.Column(db.Text, nullable=False, default="")
	data = db.Column(JsonCol, nullable=True)
	created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

	adventure = db.relationship("Adventure", back_populates="events")
	member = db.relationship("AdventureMember")

	def to_dict(self):
		return {
			"id": self.id,
			"adventureId": self.adventure_id,
			"memberId": self.member_id,
			"userId": self.member.user_id if self.member else None,
			"authorName": self.author_name,
			"characterName": self.character_name,
			"role": self.member.role if self.member else None,
			"type": self.type,
			"content": self.content,
			"data": self.data or {},
			"createdAt": _iso(self.created_at),
		}
