"""Normalized 5e reference data (races, classes, spells, …) ingested from the
site's data JSONs by `server/ingest.py`. Read-only at runtime; used to power
the character-creation pickers and server-side validation."""

from .extensions import db
from .models import JsonCol


class SrdRace(db.Model):
	__tablename__ = "srd_races"
	__table_args__ = (db.UniqueConstraint("name", "source", name="uq_srd_race"),)

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	source = db.Column(db.String(32), nullable=False)
	size = db.Column(db.String(16), nullable=True)
	speed = db.Column(db.String(64), nullable=True)

	def to_dict(self):
		return {"name": self.name, "source": self.source, "size": self.size, "speed": self.speed}


class SrdSubrace(db.Model):
	__tablename__ = "srd_subraces"

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	source = db.Column(db.String(32), nullable=False)
	race_name = db.Column(db.String(128), nullable=False, index=True)
	race_source = db.Column(db.String(32), nullable=False)

	def to_dict(self):
		return {"name": self.name, "source": self.source}


class SrdClass(db.Model):
	__tablename__ = "srd_classes"
	__table_args__ = (db.UniqueConstraint("name", "source", name="uq_srd_class"),)

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	source = db.Column(db.String(32), nullable=False)
	hit_die = db.Column(db.String(8), nullable=True)
	saves = db.Column(JsonCol, nullable=True)

	subclasses = db.relationship("SrdSubclass", back_populates="srd_class", cascade="all, delete-orphan")

	def to_dict(self):
		return {
			"name": self.name,
			"source": self.source,
			"hitDie": self.hit_die,
			"saves": self.saves or [],
			"subclasses": [sc.to_dict() for sc in self.subclasses],
		}


class SrdSubclass(db.Model):
	__tablename__ = "srd_subclasses"

	id = db.Column(db.Integer, primary_key=True)
	class_id = db.Column(db.Integer, db.ForeignKey("srd_classes.id", ondelete="CASCADE"), nullable=False, index=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	short_name = db.Column(db.String(64), nullable=True)
	source = db.Column(db.String(32), nullable=False)

	srd_class = db.relationship("SrdClass", back_populates="subclasses")

	def to_dict(self):
		return {"name": self.name, "shortName": self.short_name, "source": self.source}


class SrdBackground(db.Model):
	__tablename__ = "srd_backgrounds"
	__table_args__ = (db.UniqueConstraint("name", "source", name="uq_srd_background"),)

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	source = db.Column(db.String(32), nullable=False)
	skills = db.Column(JsonCol, nullable=True)

	def to_dict(self):
		return {"name": self.name, "source": self.source, "skills": self.skills or []}


class SrdLanguage(db.Model):
	__tablename__ = "srd_languages"
	__table_args__ = (db.UniqueConstraint("name", "source", name="uq_srd_language"),)

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	source = db.Column(db.String(32), nullable=False)

	def to_dict(self):
		return {"name": self.name, "source": self.source}


class SrdFeat(db.Model):
	__tablename__ = "srd_feats"
	__table_args__ = (db.UniqueConstraint("name", "source", name="uq_srd_feat"),)

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	source = db.Column(db.String(32), nullable=False)

	def to_dict(self):
		return {"name": self.name, "source": self.source}


class SrdSpell(db.Model):
	__tablename__ = "srd_spells"
	__table_args__ = (db.UniqueConstraint("name", "source", name="uq_srd_spell"),)

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(128), nullable=False, index=True)
	source = db.Column(db.String(32), nullable=False)
	level = db.Column(db.Integer, nullable=False, default=0)
	school = db.Column(db.String(2), nullable=True)

	def to_dict(self):
		return {"name": self.name, "source": self.source, "level": self.level, "school": self.school}
