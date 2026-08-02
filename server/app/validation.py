"""Server-side character validation against the ingested 5e reference data.

Philosophy (phase 2 of the roadmap):
- Fields with pickers (race, subrace, class, subclass, background, alignment)
  are validated strictly — but only when the corresponding reference table has
  been ingested, so a fresh dev database without `ingest.py` stays usable.
- Free-form fields (languages, spells, equipment, persona) stay lenient to
  leave room for homebrew; tightening them is a later step.
"""

from sqlalchemy import func

from .extensions import db
from .models_srd import SrdBackground, SrdClass, SrdRace, SrdSubclass, SrdSubrace

ALIGNMENTS = (
	"Lawful Good", "Neutral Good", "Chaotic Good",
	"Lawful Neutral", "True Neutral", "Chaotic Neutral",
	"Lawful Evil", "Neutral Evil", "Chaotic Evil", "Unaligned",
)

ABILITY_KEYS = ("str", "dex", "con", "int", "wis", "cha")

_table_presence_cache = {}


def _has_rows(model):
	# Reference tables only change via ingest.py (which restarts nothing but
	# only ever fills them), so cache per-process
	if model not in _table_presence_cache or not _table_presence_cache[model]:
		_table_presence_cache[model] = db.session.query(model.id).first() is not None
	return _table_presence_cache[model]


def _exists_by_name(model, name):
	return (
		db.session.query(model.id)
		.filter(func.lower(model.name) == name.strip().lower())
		.first()
		is not None
	)


def _validate_int(value, label, lo, hi, errors):
	if value is None:
		return None
	try:
		out = int(value)
	except (TypeError, ValueError):
		errors.append(f"{label} must be a number")
		return None
	if out < lo or out > hi:
		errors.append(f"{label} must be between {lo} and {hi}")
	return out


def validate_character(character):
	"""Returns a list of human-readable validation errors (empty = valid)."""
	errors = []
	sheet = character.sheet or {}

	# ==================== Pickable fields (strict when data is present) ====================
	if character.race and _has_rows(SrdRace) and not _exists_by_name(SrdRace, character.race):
		errors.append(f'Unknown species/race "{character.race}" — pick one from the list')

	subrace = sheet.get("subrace")
	if subrace and _has_rows(SrdSubrace):
		known = (
			db.session.query(SrdSubrace.id)
			.filter(
				func.lower(SrdSubrace.name) == subrace.strip().lower(),
				func.lower(SrdSubrace.race_name) == (character.race or "").strip().lower(),
			)
			.first()
		)
		if not known:
			errors.append(f'"{subrace}" is not a subrace of "{character.race or "?"}"')

	srd_class = None
	if character.char_class and _has_rows(SrdClass):
		srd_class = (
			db.session.query(SrdClass)
			.filter(func.lower(SrdClass.name) == character.char_class.strip().lower())
			.first()
		)
		if srd_class is None:
			errors.append(f'Unknown class "{character.char_class}" — pick one from the list')

	subclass = sheet.get("subclass")
	if subclass and _has_rows(SrdSubclass):
		if srd_class is None:
			if character.char_class:
				pass  # class itself already reported unknown
			else:
				errors.append("Choose a class before choosing a subclass")
		else:
			class_ids = [
				row.id
				for row in db.session.query(SrdClass.id)
				.filter(func.lower(SrdClass.name) == character.char_class.strip().lower())
			]
			known = (
				db.session.query(SrdSubclass.id)
				.filter(
					SrdSubclass.class_id.in_(class_ids),
					(func.lower(SrdSubclass.name) == subclass.strip().lower())
					| (func.lower(SrdSubclass.short_name) == subclass.strip().lower()),
				)
				.first()
			)
			if not known:
				errors.append(f'"{subclass}" is not a {character.char_class} subclass')

	background = sheet.get("background")
	if background and _has_rows(SrdBackground) and not _exists_by_name(SrdBackground, background):
		errors.append(f'Unknown background "{background}" — pick one from the list')

	alignment = sheet.get("alignment")
	if alignment and alignment not in ALIGNMENTS:
		errors.append(f'Unknown alignment "{alignment}"')

	# ==================== Numeric sanity ====================
	abilities = sheet.get("abilities")
	if abilities is not None:
		if not isinstance(abilities, dict):
			errors.append("abilities must be an object")
		else:
			for key, value in abilities.items():
				if key not in ABILITY_KEYS:
					errors.append(f'Unknown ability "{key}"')
				else:
					_validate_int(value, f"{key.upper()} score", 1, 30, errors)

	_validate_int(sheet.get("xp"), "XP", 0, 1_000_000_000, errors)

	combat = sheet.get("combat") or {}
	if isinstance(combat, dict):
		_validate_int(combat.get("ac"), "Armor class", 1, 40, errors)
		_validate_int(combat.get("hpMax"), "Max HP", 1, 9999, errors)
		_validate_int(combat.get("hpCurrent"), "Current HP", -9999, 9999, errors)
		_validate_int(combat.get("hpTemp"), "Temp HP", 0, 9999, errors)
		_validate_int(combat.get("initiativeBonus"), "Initiative bonus", -20, 40, errors)

	equipment = sheet.get("equipment") or {}
	coins = equipment.get("coins") if isinstance(equipment, dict) else None
	if isinstance(coins, dict):
		for coin, value in coins.items():
			_validate_int(value, f"{coin} coins", 0, 1_000_000_000, errors)

	return errors
