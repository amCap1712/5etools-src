"""Read-only endpoints serving the normalized 5e reference data for the
character-creation pickers. Public (no auth): this is game reference data."""

from flask import Blueprint, jsonify

from ..extensions import db
from ..models_srd import (
	SrdBackground,
	SrdClass,
	SrdFeat,
	SrdLanguage,
	SrdRace,
	SrdSpell,
	SrdSubrace,
)
from ..validation import ALIGNMENTS

bp = Blueprint("srd", __name__)

SPELL_SCHOOLS = {
	"A": "Abjuration", "C": "Conjuration", "D": "Divination", "E": "Enchantment",
	"V": "Evocation", "I": "Illusion", "N": "Necromancy", "T": "Transmutation",
	"P": "Psionics",
}


@bp.get("/srd/options")
def get_options():
	races = db.session.query(SrdRace).order_by(SrdRace.name, SrdRace.source).all()
	subraces = db.session.query(SrdSubrace).order_by(SrdSubrace.name).all()
	classes = db.session.query(SrdClass).order_by(SrdClass.name, SrdClass.source).all()
	backgrounds = db.session.query(SrdBackground).order_by(SrdBackground.name, SrdBackground.source).all()
	languages = db.session.query(SrdLanguage).order_by(SrdLanguage.name).all()
	feats = db.session.query(SrdFeat).order_by(SrdFeat.name).all()

	subraces_by_race = {}
	for subrace in subraces:
		subraces_by_race.setdefault(subrace.race_name.lower(), []).append(subrace.to_dict())

	race_dicts = []
	for race in races:
		out = race.to_dict()
		out["subraces"] = subraces_by_race.get(race.name.lower(), [])
		race_dicts.append(out)

	return jsonify({
		"ingested": bool(races or classes),
		"alignments": list(ALIGNMENTS),
		"races": race_dicts,
		"classes": [c.to_dict() for c in classes],
		"backgrounds": [b.to_dict() for b in backgrounds],
		"languages": [lang.to_dict() for lang in languages],
		"feats": [f.to_dict() for f in feats],
	})


@bp.get("/srd/spells")
def get_spells():
	spells = db.session.query(SrdSpell).order_by(SrdSpell.level, SrdSpell.name).all()
	return jsonify({
		"schools": SPELL_SCHOOLS,
		"spells": [s.to_dict() for s in spells],
	})
