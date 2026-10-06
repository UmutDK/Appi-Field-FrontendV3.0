"""
Routes pour les cultures.
Schéma DB : tables `crops` et `cropsParcels` (liaison N-N avec parcels).
Colonnes : cropId, userId, cropName, remarks, sowingDate, previousCrop, harvestDate,
           efficiency, collection, phytowebId, eppo, isArchived.
"""
import json
import os
import uuid
from datetime import datetime
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, cursor_phytoweb, commit_appifield
from app.auth import require_auth

bp = Blueprint("crops", __name__, url_prefix="/crops")

_LEGACY_NAMES_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "legacy_phytoweb_crop_names.json")
_legacy_phytoweb_names: dict[str, str] | None = None


def _load_legacy_phytoweb_names() -> dict[str, str]:
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


def _collection_from_sowing_date(sowing_date: str | None) -> str:
    if not sowing_date:
        return "Cultures"
    try:
        return str(datetime.strptime(sowing_date[:10], "%Y-%m-%d").year)
    except ValueError:
        return "Cultures"


def _attach_parcels(cur, crops: list) -> list:
    """Enrichit chaque culture avec la liste de ses parcelles depuis cropsParcels."""
    for crop in crops:
        cur.execute(
            "SELECT * FROM cropsParcels WHERE cropId = %s AND userId = %s",
            (crop["cropId"], crop["userId"]),
        )
        crop["parcels"] = cur.fetchall()
    return crops


def _attach_phytoweb_names(crops: list) -> list:
    """
    Enrichit chaque culture avec `phytowebName`, résolu depuis phytowebId :
    - d'abord contre `indexCrop` (c2544857c_corderPhytoweb, référentiel officiel) ;
    - sinon contre `phytowebCategoryOverrides` (c2544857c_appifield, catégories admin
      personnalisées, qui n'existent pas dans indexCrop) ;
    - sinon contre le mapping legacy (cultures créées avant la migration, voir
      _load_legacy_phytoweb_names).
    """
    ids = list({crop["phytowebId"] for crop in crops if crop.get("phytowebId")})
    if not ids:
        for crop in crops:
            crop["phytowebName"] = ""
        return crops

    names_by_id: dict[str, str] = {}

    placeholders = ", ".join(["%s"] * len(ids))
    cur_phytoweb = cursor_phytoweb()
    cur_phytoweb.execute(
        f"SELECT idCrop, cropName FROM indexCrop WHERE idCrop IN ({placeholders})", tuple(ids)
    )
    for row in cur_phytoweb.fetchall():
        names_by_id[row["idCrop"]] = row["cropName"]

    remaining_ids = [i for i in ids if i not in names_by_id]
    if remaining_ids:
        placeholders = ", ".join(["%s"] * len(remaining_ids))
        cur_appifield = cursor_appifield()
        cur_appifield.execute(
            f"SELECT cropId, nameFr FROM phytowebCategoryOverrides WHERE cropId IN ({placeholders})",
            tuple(remaining_ids),
        )
        for row in cur_appifield.fetchall():
            names_by_id[row["cropId"]] = row["nameFr"]

    remaining_ids = [i for i in ids if i not in names_by_id]
    if remaining_ids:
        legacy_names = _load_legacy_phytoweb_names()
        for crop_id in remaining_ids:
            if crop_id in legacy_names:
                names_by_id[crop_id] = legacy_names[crop_id]

    for crop in crops:
        crop["phytowebName"] = names_by_id.get(crop.get("phytowebId"), "")
    return crops


@bp.get("")
@require_auth
def get_crops(user_id):
    """Retourne les cultures actives (non archivées) avec leurs parcelles."""
    cur = cursor_appifield()
    cur.execute("SELECT * FROM crops WHERE userId = %s AND isArchived = 0", (user_id,))
    crops = cur.fetchall()
    return jsonify(_attach_phytoweb_names(_attach_parcels(cur, crops)))


@bp.get("/archive")
@require_auth
def get_crops_archive(user_id):
    """Retourne les cultures archivées avec leurs parcelles."""
    cur = cursor_appifield()
    cur.execute("SELECT * FROM crops WHERE userId = %s AND isArchived = 1", (user_id,))
    crops = cur.fetchall()
    return jsonify(_attach_phytoweb_names(_attach_parcels(cur, crops)))


@bp.get("/<crop_id>")
@require_auth
def get_crop(user_id, crop_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM crops WHERE cropId = %s AND userId = %s", (crop_id, user_id))
    crop = cur.fetchone()
    if not crop:
        return jsonify({"error": "Culture non trouvée"}), 404
    cur.execute("SELECT * FROM cropsParcels WHERE cropId = %s AND userId = %s", (crop_id, user_id))
    crop["parcels"] = cur.fetchall()
    _attach_phytoweb_names([crop])
    return jsonify(crop)


@bp.post("")
@require_auth
def create_crop(user_id):
    """
    Crée une culture. Si `parcelIds` (liste) est fourni dans le body,
    crée également les entrées dans cropsParcels.
    """
    data = request.get_json(force=True)
    if not data.get("cropName"):
        return jsonify({"error": "cropName requis"}), 400
    crop_id = data.get("cropId") or str(uuid.uuid4())
    sowing_date = data.get("sowingDate")
    collection = data.get("collection") or _collection_from_sowing_date(sowing_date)

    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO crops (cropId, userId, cropName, remarks, sowingDate, previousCrop, harvestDate,
           efficiency, collection, phytowebId, eppo, isArchived)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0)""",
        (
            crop_id, user_id,
            data.get("cropName"), data.get("remarks"),
            sowing_date, data.get("previousCrop"), data.get("harvestDate"),
            data.get("efficiency"), collection,
            data.get("phytowebId"), data.get("eppo"),
        ),
    )

    for parcel_id in data.get("parcelIds", []):
        cur.execute(
            "INSERT INTO cropsParcels (cropParcelId, cropId, userId, parcelId) VALUES (%s, %s, %s, %s)",
            (str(uuid.uuid4()), crop_id, user_id, parcel_id),
        )

    commit_appifield()
    return jsonify({"success": True, "cropId": crop_id}), 201


@bp.put("/<crop_id>")
@require_auth
def update_crop(user_id, crop_id):
    """
    Met à jour une culture. Seuls les champs présents dans le body sont modifiés
    (mise à jour partielle) : un appelant qui ne veut changer que `collection`
    (ex. archivage) ne doit pas écraser le reste à NULL. Si `parcelIds` est fourni,
    remplace entièrement les liaisons dans cropsParcels.
    """
    data = request.get_json(force=True)

    updatable_columns = (
        "cropName", "remarks", "sowingDate", "previousCrop",
        "harvestDate", "efficiency", "phytowebId", "eppo",
    )
    fields = {col: data[col] for col in updatable_columns if col in data}

    if "collection" in data:
        fields["collection"] = data["collection"]
    elif "sowingDate" in data:
        fields["collection"] = _collection_from_sowing_date(data["sowingDate"])

    cur = cursor_appifield()
    if fields:
        set_clause = ", ".join(f"{col} = %s" for col in fields)
        cur.execute(
            f"UPDATE crops SET {set_clause} WHERE cropId = %s AND userId = %s",
            (*fields.values(), crop_id, user_id),
        )

    if "parcelIds" in data:
        cur.execute("DELETE FROM cropsParcels WHERE cropId = %s AND userId = %s", (crop_id, user_id))
        for parcel_id in data["parcelIds"]:
            cur.execute(
                "INSERT INTO cropsParcels (cropParcelId, cropId, userId, parcelId) VALUES (%s, %s, %s, %s)",
                (str(uuid.uuid4()), crop_id, user_id, parcel_id),
            )

    commit_appifield()
    return jsonify({"success": True})


@bp.post("/<crop_id>/archive")
@require_auth
def archive_crop(user_id, crop_id):
    cur = cursor_appifield()
    cur.execute(
        "UPDATE crops SET isArchived = 1 WHERE cropId = %s AND userId = %s",
        (crop_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.post("/<crop_id>/unarchive")
@require_auth
def unarchive_crop(user_id, crop_id):
    cur = cursor_appifield()
    cur.execute(
        "UPDATE crops SET isArchived = 0 WHERE cropId = %s AND userId = %s",
        (crop_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<crop_id>")
@require_auth
def delete_crop(user_id, crop_id):
    cur = cursor_appifield()
    cur.execute("DELETE FROM cropsParcels WHERE cropId = %s AND userId = %s", (crop_id, user_id))
    cur.execute("DELETE FROM crops WHERE cropId = %s AND userId = %s", (crop_id, user_id))
    commit_appifield()
    return jsonify({"success": True})
