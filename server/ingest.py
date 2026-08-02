"""Ingest the site's 5e data JSONs into normalized DB tables.

The source JSONs in `data/` are read-only inputs — this script never modifies
them. Re-running is idempotent: SRD tables are wiped and repopulated.

Usage:
	python ingest.py [--data-dir ../data]
"""

import argparse
import json
import os
import sys

from app import create_app
from app.extensions import db
from app.models_srd import (
	SrdBackground,
	SrdClass,
	SrdFeat,
	SrdLanguage,
	SrdRace,
	SrdSpell,
	SrdSubclass,
	SrdSubrace,
)

_DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def _load(data_dir, *parts):
	path = os.path.join(data_dir, *parts)
	with open(path, encoding="utf-8") as f:
		return json.load(f)


def _fmt_speed(speed):
	if speed is None:
		return None
	if isinstance(speed, (int, float)):
		return f"{int(speed)} ft."
	if isinstance(speed, dict):
		parts = []
		for mode, value in speed.items():
			if value is True:
				continue
			if isinstance(value, dict):
				value = value.get("number")
			if isinstance(value, (int, float)):
				parts.append(f"{mode} {int(value)} ft.")
		return ", ".join(parts) or None
	return None


def _fmt_size(size):
	if isinstance(size, list) and size:
		return "/".join(str(s) for s in size)
	return str(size) if size else None


def ingest_races(data_dir):
	data = _load(data_dir, "races.json")
	races, subraces = 0, 0
	seen = set()
	for entry in data.get("race", []):
		name, source = entry.get("name"), entry.get("source")
		if not name or not source or (name.lower(), source) in seen:
			continue
		seen.add((name.lower(), source))
		db.session.add(SrdRace(name=name, source=source, size=_fmt_size(entry.get("size")), speed=_fmt_speed(entry.get("speed"))))
		races += 1
	for entry in data.get("subrace", []):
		name = entry.get("name")
		if not name or not entry.get("raceName"):
			continue
		db.session.add(SrdSubrace(
			name=name,
			source=entry.get("source") or "?",
			race_name=entry["raceName"],
			race_source=entry.get("raceSource") or "?",
		))
		subraces += 1
	return races, subraces


def ingest_classes(data_dir):
	index = _load(data_dir, "class", "index.json")
	classes, subclasses = 0, 0
	class_map = {}
	pending_subclasses = []

	for filename in index.values():
		data = _load(data_dir, "class", filename)
		for entry in data.get("class", []):
			name, source = entry.get("name"), entry.get("source")
			if not name or not source or (name.lower(), source) in class_map:
				continue
			hd = entry.get("hd") or {}
			hit_die = f"{hd.get('number', 1)}d{hd['faces']}" if hd.get("faces") else None
			srd_class = SrdClass(name=name, source=source, hit_die=hit_die, saves=entry.get("proficiency") or [])
			db.session.add(srd_class)
			class_map[(name.lower(), source)] = srd_class
			classes += 1
		pending_subclasses.extend(data.get("subclass", []))

	db.session.flush()

	# Fallback lookup by class name alone, for subclasses whose classSource
	# points at a class defined under a different source key
	by_name = {}
	for (name_lower, _source), srd_class in class_map.items():
		by_name.setdefault(name_lower, srd_class)

	seen = set()
	for entry in pending_subclasses:
		name, class_name = entry.get("name"), entry.get("className")
		if not name or not class_name:
			continue
		parent = class_map.get((class_name.lower(), entry.get("classSource"))) or by_name.get(class_name.lower())
		if parent is None:
			continue
		key = (parent.id or id(parent), name.lower(), entry.get("source"))
		if key in seen:
			continue
		seen.add(key)
		db.session.add(SrdSubclass(
			srd_class=parent,
			name=name,
			short_name=entry.get("shortName"),
			source=entry.get("source") or "?",
		))
		subclasses += 1
	return classes, subclasses


def ingest_backgrounds(data_dir):
	data = _load(data_dir, "backgrounds.json")
	count = 0
	seen = set()
	for entry in data.get("background", []):
		name, source = entry.get("name"), entry.get("source")
		if not name or not source or (name.lower(), source) in seen:
			continue
		seen.add((name.lower(), source))
		skills = sorted({
			skill
			for prof_group in entry.get("skillProficiencies") or []
			for skill, chosen in prof_group.items()
			if chosen is True and skill not in ("choose", "any", "anyStandard")
		})
		db.session.add(SrdBackground(name=name, source=source, skills=skills))
		count += 1
	return count


def _ingest_simple(data_dir, filename, json_key, model):
	data = _load(data_dir, filename)
	count = 0
	seen = set()
	for entry in data.get(json_key, []):
		name, source = entry.get("name"), entry.get("source")
		if not name or not source or (name.lower(), source) in seen:
			continue
		seen.add((name.lower(), source))
		db.session.add(model(name=name, source=source))
		count += 1
	return count


def ingest_spells(data_dir):
	index = _load(data_dir, "spells", "index.json")
	count = 0
	seen = set()
	for filename in index.values():
		data = _load(data_dir, "spells", filename)
		for entry in data.get("spell", []):
			name, source = entry.get("name"), entry.get("source")
			if not name or not source or (name.lower(), source) in seen:
				continue
			seen.add((name.lower(), source))
			db.session.add(SrdSpell(name=name, source=source, level=entry.get("level") or 0, school=entry.get("school")))
			count += 1
	return count


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--data-dir", default=_DEFAULT_DATA_DIR, help="Path to the site's data/ directory")
	args = parser.parse_args()
	data_dir = os.path.abspath(args.data_dir)

	if not os.path.isfile(os.path.join(data_dir, "races.json")):
		print(f"error: {data_dir} does not look like the 5etools data directory", file=sys.stderr)
		sys.exit(1)

	app = create_app()
	with app.app_context():
		for model in (SrdSubclass, SrdClass, SrdSubrace, SrdRace, SrdBackground, SrdLanguage, SrdFeat, SrdSpell):
			db.session.query(model).delete()

		races, subraces = ingest_races(data_dir)
		classes, subclasses = ingest_classes(data_dir)
		backgrounds = ingest_backgrounds(data_dir)
		languages = _ingest_simple(data_dir, "languages.json", "language", SrdLanguage)
		feats = _ingest_simple(data_dir, "feats.json", "feat", SrdFeat)
		spells = ingest_spells(data_dir)
		db.session.commit()

		print(f"ingested: {races} races, {subraces} subraces, {classes} classes, {subclasses} subclasses,")
		print(f"          {backgrounds} backgrounds, {languages} languages, {feats} feats, {spells} spells")


if __name__ == "__main__":
	main()
