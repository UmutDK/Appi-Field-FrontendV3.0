"""
Routes pour les parcelles agricoles.
Schéma DB : table `parcels` (voir database/init_first_db.py).
Colonnes : parcelId, userId, parcelName, parcelArea, parcelAreaUnitId,
           standardParcelArea, latitude, longitude, polygon, parcelCategory,
           parcelAddress, recordType.
L'unité de surface est fournie par le client via `parcelAreaUnit` (nom, ex. "ha") ;
elle est résolue en idUnit et la surface standardisée (`standardParcelArea`) est
calculée à l'écriture, comme le faisait auparavant le script batch unitParcelsPGindexer.py.
"""
import json
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth
from app.utils.units import resolve_and_standardize, find_unit_name_by_id
from app.utils.gml_import import parse_gml_to_parcels, GmlImportError

bp = Blueprint("parcels", __name__, url_prefix="/parcels")

_MAX_GML_SIZE = 10 * 1024 * 1024


def _serialize_polygon(polygon):
    if isinstance(polygon, (list, dict)):
        return json.dumps(polygon, ensure_ascii=False)
    return polygon


def _attach_area_unit(parcels: list) -> list:
    """Enrichit chaque parcelle avec `parcelAreaUnit` (nom), résolu depuis parcelAreaUnitId."""
    for parcel in parcels:
        parcel["parcelAreaUnit"] = find_unit_name_by_id(parcel.get("parcelAreaUnitId"))
    return parcels


def _insert_parcel(user_id, data) -> str:
    """Insère une parcelle et retourne son id. Partagé par POST /parcels et l'import GML."""
    new_id = data.get("parcelId") or str(uuid.uuid4())
    parcel_area = data.get("parcelArea")
    unit_id, standard_area = resolve_and_standardize(parcel_area, data.get("parcelAreaUnit"))

    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO parcels
            (parcelId, userId, parcelName, parcelArea, parcelAreaUnitId,
             standardParcelArea, latitude, longitude, polygon, parcelCategory,
             parcelAddress, recordType)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            new_id,
            user_id,
            data.get("parcelName"),
            parcel_area,
            unit_id,
            standard_area,
            data.get("latitude"),
            data.get("longitude"),
            _serialize_polygon(data.get("polygon")),
            data.get("parcelCategory"),
            data.get("parcelAddress"),
            data.get("recordType"),
        ),
    )
    return new_id


@bp.get("")
@require_auth
def get_parcels(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM parcels WHERE userId = %s", (user_id,))
    return jsonify(_attach_area_unit(cur.fetchall()))


@bp.get("/<parcel_id>")
@require_auth
def get_parcel(user_id, parcel_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM parcels WHERE parcelId = %s AND userId = %s", (parcel_id, user_id))
    row = cur.fetchone()
    if not row:
        return jsonify({"error": "Parcelle non trouvée"}), 404
    _attach_area_unit([row])
    return jsonify(row)


@bp.post("")
@require_auth
def create_parcel(user_id):
    data = request.get_json(force=True)
    if not data.get("parcelName"):
        return jsonify({"error": "parcelName requis"}), 400
    new_id = _insert_parcel(user_id, data)
    commit_appifield()
    return jsonify({"success": True, "parcelId": new_id}), 201


@bp.post("/import_gml")
@require_auth
def import_gml(user_id):
    """Importe les parcelles d'un fichier GML PAC (V1) ou MR14 (V2) — multipart, champ 'gml_file'."""
    uploaded = request.files.get("gml_file")
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Aucun fichier GML fourni"}), 400
    if not uploaded.filename.lower().endswith(".gml"):
        return jsonify({"error": "Le fichier doit avoir l'extension .gml"}), 400

    gml_bytes = uploaded.read()
    if len(gml_bytes) > _MAX_GML_SIZE:
        return jsonify({"error": "Le fichier est trop volumineux (max 10 Mo)"}), 400

    try:
        parsed_parcels = parse_gml_to_parcels(gml_bytes)
    except GmlImportError as e:
        return jsonify({"error": str(e)}), 400

    imported_ids = []
    for parcel_data in parsed_parcels:
        imported_ids.append(_insert_parcel(user_id, parcel_data))
    commit_appifield()

    return jsonify({
        "success": True,
        "imported": len(imported_ids),
        "parcelIds": imported_ids,
    }), 201


@bp.put("/<parcel_id>")
@require_auth
def update_parcel(user_id, parcel_id):
    data = request.get_json(force=True)
    parcel_area = data.get("parcelArea")
    unit_id, standard_area = resolve_and_standardize(parcel_area, data.get("parcelAreaUnit"))

    cur = cursor_appifield()
    cur.execute(
        """UPDATE parcels SET parcelName = %s, parcelArea = %s,
           parcelAreaUnitId = %s, standardParcelArea = %s, latitude = %s, longitude = %s,
           polygon = %s, parcelCategory = %s, parcelAddress = %s, recordType = %s
           WHERE parcelId = %s AND userId = %s""",
        (
            data.get("parcelName"),
            parcel_area,
            unit_id,
            standard_area,
            data.get("latitude"),
            data.get("longitude"),
            _serialize_polygon(data.get("polygon")),
            data.get("parcelCategory"),
            data.get("parcelAddress"),
            data.get("recordType"),
            parcel_id,
            user_id,
        ),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<parcel_id>")
@require_auth
def delete_parcel(user_id, parcel_id):
    cur = cursor_appifield()
    cur.execute("DELETE FROM parcels WHERE parcelId = %s AND userId = %s", (parcel_id, user_id))
    commit_appifield()
    return jsonify({"success": True})
