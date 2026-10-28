"""
Routes pour les parcelles agricoles.
Schéma DB : table `parcels` (voir database/init_first_db.py).
Colonnes : parcelId, userId, parcelName, parcelArea, parcelAreaUnitId,
           standardParcelArea, latitude, longitude, polygon, parcelCategory,
           parcelAddress, recordType, isArchived, prevParcelId, sigecCode.
L'unité de surface est fournie par le client via `parcelAreaUnit` (nom, ex. "ha") ;
elle est résolue en idUnit et la surface standardisée (`standardParcelArea`) est
calculée à l'écriture, comme le faisait auparavant le script batch unitParcelsPGindexer.py.
Archivage (migration 016) : isArchived ne se modifie que via /archive, /unarchive et
/renew (jamais via PUT). Une parcelle archivée reste liée à ses cultures/traitements/
travaux existants : c'est au frontend de ne plus la proposer pour de nouvelles saisies.
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


def _clean_sigec(value):
    """Code SIGEC normalisé : chaîne sans espaces superflus, ou None si vide."""
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _insert_parcel(user_id, data, prev_parcel_id=None) -> str:
    """Insère une parcelle (active) et retourne son id. Partagé par POST /parcels, l'import GML et /renew."""
    new_id = data.get("parcelId") or str(uuid.uuid4())
    parcel_area = data.get("parcelArea")
    unit_id, standard_area = resolve_and_standardize(parcel_area, data.get("parcelAreaUnit"))

    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO parcels
            (parcelId, userId, parcelName, parcelArea, parcelAreaUnitId,
             standardParcelArea, latitude, longitude, polygon, parcelCategory,
             parcelAddress, recordType, isArchived, prevParcelId, sigecCode)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, %s, %s)""",
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
            prev_parcel_id,
            _clean_sigec(data.get("sigecCode")),
        ),
    )
    return new_id


def _set_archived(user_id, parcel_id, archived: bool):
    cur = cursor_appifield()
    cur.execute("SELECT 1 FROM parcels WHERE parcelId = %s AND userId = %s", (parcel_id, user_id))
    if not cur.fetchone():
        return jsonify({"error": "Parcelle non trouvée"}), 404
    cur.execute(
        "UPDATE parcels SET isArchived = %s WHERE parcelId = %s AND userId = %s",
        (1 if archived else 0, parcel_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.get("")
@require_auth
def get_parcels(user_id):
    """
    Parcelles de l'utilisateur, archivées comprises par défaut (chaque ligne porte isArchived) :
    les écrans qui affichent des saisies existantes ont besoin des parcelles archivées.
    Query optionnel : ?archived=0 (actives uniquement) ou ?archived=1 (archivées uniquement).
    """
    archived = request.args.get("archived")
    cur = cursor_appifield()
    if archived in ("0", "1"):
        cur.execute(
            "SELECT * FROM parcels WHERE userId = %s AND isArchived = %s", (user_id, int(archived))
        )
    else:
        cur.execute("SELECT * FROM parcels WHERE userId = %s", (user_id,))
    return jsonify(_attach_area_unit(cur.fetchall()))


@bp.get("/archive")
@require_auth
def get_parcels_archive(user_id):
    """Parcelles archivées (menu d'archives des parcelles), même pattern que /crops/archive."""
    cur = cursor_appifield()
    cur.execute("SELECT * FROM parcels WHERE userId = %s AND isArchived = 1", (user_id,))
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

    # sigecCode n'est mis à jour que s'il est envoyé : un client qui ne le connaît pas encore
    # ne doit pas l'effacer. isArchived/prevParcelId ne se modifient jamais ici.
    sigec_clause, sigec_params = "", ()
    if "sigecCode" in data:
        sigec_clause, sigec_params = ", sigecCode = %s", (_clean_sigec(data["sigecCode"]),)

    cur = cursor_appifield()
    cur.execute(
        f"""UPDATE parcels SET parcelName = %s, parcelArea = %s,
           parcelAreaUnitId = %s, standardParcelArea = %s, latitude = %s, longitude = %s,
           polygon = %s, parcelCategory = %s, parcelAddress = %s, recordType = %s{sigec_clause}
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
            *sigec_params,
            parcel_id,
            user_id,
        ),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.post("/<parcel_id>/archive")
@require_auth
def archive_parcel(user_id, parcel_id):
    return _set_archived(user_id, parcel_id, True)


@bp.post("/<parcel_id>/unarchive")
@require_auth
def unarchive_parcel(user_id, parcel_id):
    return _set_archived(user_id, parcel_id, False)


@bp.post("/<parcel_id>/renew")
@require_auth
def renew_parcel(user_id, parcel_id):
    """
    « Archiver et renouveler » : même parcelle, nouveau numéro PAC.
    Body : { sigecCode } (obligatoire). Archive la parcelle et en crée une copie active
    (mêmes surface, géométrie, catégorie, adresse, type) nommée « <nom> (1) », avec le
    nouveau code SIGEC et prevParcelId = id de la parcelle archivée. Les cultures/traitements/
    travaux existants restent liés à l'ancienne parcelle.
    """
    data = request.get_json(force=True) or {}
    sigec_code = _clean_sigec(data.get("sigecCode"))
    if not sigec_code:
        return jsonify({"error": "sigecCode requis"}), 400

    cur = cursor_appifield()
    cur.execute("SELECT * FROM parcels WHERE parcelId = %s AND userId = %s", (parcel_id, user_id))
    old = cur.fetchone()
    if not old:
        return jsonify({"error": "Parcelle non trouvée"}), 404
    if old.get("isArchived"):
        return jsonify({"error": "Parcelle déjà archivée"}), 409

    new_id = _insert_parcel(user_id, {
        "parcelName": f"{old.get('parcelName') or ''} (1)",
        "parcelArea": old.get("parcelArea"),
        "parcelAreaUnit": find_unit_name_by_id(old.get("parcelAreaUnitId")),
        "latitude": old.get("latitude"),
        "longitude": old.get("longitude"),
        "polygon": old.get("polygon"),
        "parcelCategory": old.get("parcelCategory"),
        "parcelAddress": old.get("parcelAddress"),
        "recordType": old.get("recordType"),
        "sigecCode": sigec_code,
    }, prev_parcel_id=parcel_id)
    cur.execute(
        "UPDATE parcels SET isArchived = 1 WHERE parcelId = %s AND userId = %s", (parcel_id, user_id)
    )
    commit_appifield()
    return jsonify({"success": True, "parcelId": new_id, "archivedParcelId": parcel_id}), 201


@bp.delete("/<parcel_id>")
@require_auth
def delete_parcel(user_id, parcel_id):
    cur = cursor_appifield()
    cur.execute("DELETE FROM parcels WHERE parcelId = %s AND userId = %s", (parcel_id, user_id))
    commit_appifield()
    return jsonify({"success": True})
