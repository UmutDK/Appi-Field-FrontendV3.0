"""
Rattachement des cultures utilisateur (crops.phytowebId, c2544857c_appifield) au référentiel
Phytoweb courant (indexCrop.idCrop / crops.idCrop, c2544857c_corderPhytoweb).

Au 27/10/2026, ~99 % des cultures portent encore un phytowebId de l'ancien référentiel PHP
(`pwc-<uuid>`, tiret) qui n'existe plus dans indexCrop (`pwc_<uuid>`, underscore) : on ne
peut les rattacher que par leur NOM (mapping legacy id -> nom, puis nom -> indexCrop).
Ordre de résolution d'un phytowebId :
  1. présent tel quel dans indexCrop ;
  2. catégorie admin (phytowebCategoryOverrides) -> son initialCropId s'il est dans indexCrop ;
  3. nom legacy (app/data/legacy_phytoweb_crop_names.json) -> indexCrop par nom normalisé.
Sinon : non rattaché (catégories génériques type « céréales », « grandes cultures »).
"""
import json
import os
import unicodedata

from app.db import cursor_appifield, cursor_phytoweb

_LEGACY_NAMES_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "legacy_phytoweb_crop_names.json")
_legacy_phytoweb_names: dict[str, str] | None = None


def load_legacy_phytoweb_names() -> dict[str, str]:
    """
    Charge (une seule fois, en mémoire) le mapping crop_id -> name_fr de l'ancien
    référentiel PHP (previousServer/index/phytoweb_crops.json, récupéré depuis l'ancien
    serveur avant sa mise hors service). Dernier recours pour les cultures créées avant
    la migration vers indexCrop : leur phytowebId (format `pwc-<uuid>`, tiret) ne
    correspond à rien dans le référentiel actuel (`pwc_<uuid>`, underscore) ni dans les
    surcharges admin (phytowebCategoryOverrides).
    """
    global _legacy_phytoweb_names
    if _legacy_phytoweb_names is None:
        with open(_LEGACY_NAMES_PATH, encoding="utf-8") as f:
            _legacy_phytoweb_names = json.load(f)
    return _legacy_phytoweb_names


def normalize_crop_name(name: str | None) -> str:
    """Casse, espaces multiples et apostrophe typographique (’) neutralisés."""
    name = unicodedata.normalize("NFKC", name or "").replace("’", "'").strip().lower()
    return " ".join(name.split())


def resolve_index_crop_ids(phytoweb_ids) -> dict[str, str]:
    """Retourne {phytowebId: idCrop indexCrop} pour les identifiants rattachables (les autres sont absents)."""
    ids = {i for i in phytoweb_ids if i}
    if not ids:
        return {}

    cur = cursor_phytoweb()
    cur.execute("SELECT idCrop, cropName FROM indexCrop")
    index_rows = cur.fetchall()
    index_ids = {row["idCrop"] for row in index_rows}
    index_by_name = {normalize_crop_name(row["cropName"]): row["idCrop"] for row in index_rows}

    resolved = {i: i for i in ids if i in index_ids}

    remaining = ids - resolved.keys()
    if remaining:
        placeholders = ", ".join(["%s"] * len(remaining))
        cur_app = cursor_appifield()
        cur_app.execute(
            f"SELECT cropId, initialCropId FROM phytowebCategoryOverrides WHERE cropId IN ({placeholders})",
            tuple(remaining),
        )
        for row in cur_app.fetchall():
            if row["initialCropId"] in index_ids:
                resolved[row["cropId"]] = row["initialCropId"]

    remaining = ids - resolved.keys()
    if remaining:
        legacy_names = load_legacy_phytoweb_names()
        for phytoweb_id in remaining:
            id_crop = index_by_name.get(normalize_crop_name(legacy_names.get(phytoweb_id)))
            if id_crop:
                resolved[phytoweb_id] = id_crop

    return resolved
