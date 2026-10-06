"""
Préférences d'affichage/encodage de l'utilisateur.
Schéma DB : table `preferences`, une ligne par utilisateur (upsert).
Remplace previousServer/users_pref.json.
"""
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth

bp = Blueprint("preferences", __name__, url_prefix="/preferences")

_BOOL_FIELDS = (
    "trackFieldWorks",
    "trackLargeCrops",
    "trackMarketGardening",
    "trackForageCrops",
    "trackOrnamentalPlants",
    "trackArboriculture",
    "trackNurseriesViticultureChristmasTrees",
)


@bp.get("")
@require_auth
def get_preferences(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM preferences WHERE userId = %s", (user_id,))
    return jsonify(cur.fetchone())


@bp.post("")
@require_auth
def upsert_preferences(user_id):
    data = request.get_json(force=True)
    bool_values = [bool(data.get(field)) for field in _BOOL_FIELDS]

    cur = cursor_appifield()
    cur.execute(
        f"""INSERT INTO preferences
                (userId, sprayerType, treatmentEncodingMode, {", ".join(_BOOL_FIELDS)})
            VALUES (%s, %s, %s, {", ".join(["%s"] * len(_BOOL_FIELDS))})
            ON DUPLICATE KEY UPDATE
                sprayerType = VALUES(sprayerType),
                treatmentEncodingMode = VALUES(treatmentEncodingMode),
                {", ".join(f"{field} = VALUES({field})" for field in _BOOL_FIELDS)}""",
        (user_id, data.get("sprayerType"), data.get("treatmentEncodingMode"), *bool_values),
    )
    commit_appifield()
    return jsonify({"success": True})
