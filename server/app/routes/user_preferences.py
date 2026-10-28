"""
Préférences d'encodage des traitements phyto (menu Réglages > Préférences).
Schéma DB : table `userPreferences` (migration 014), une ligne par utilisateur, clé `idUser`.
Remplace l'ancienne route /preferences (table `preferences`, supprimée par la migration 015).
"""
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth
from app.utils.user_preferences import (
    BOOL_FIELDS, TREATMENT_TYPE_TO_EVENT_TYPE, get_user_preferences,
)

bp = Blueprint("user_preferences", __name__, url_prefix="/user_preferences")


@bp.get("")
@require_auth
def get_preferences(user_id):
    """Préférences de l'utilisateur (valeurs par défaut s'il n'en a jamais enregistré)."""
    return jsonify(get_user_preferences(user_id))


@bp.put("")
@require_auth
def update_preferences(user_id):
    """
    Met à jour les préférences (upsert). Body : { erRiWarningFlag?, spe8HourWarningFlag?,
    bbchWarningFlag?, defaultTreatmentType? } — champs optionnels, ceux omis conservent leur
    valeur actuelle (ou la valeur par défaut). Retourne les préférences complètes à jour.
    """
    data = request.get_json(force=True) or {}

    for field in BOOL_FIELDS:
        if field in data and not isinstance(data[field], (bool, int)):
            return jsonify({"error": f"{field} doit être un booléen"}), 400
    treatment_type = data.get("defaultTreatmentType")
    if treatment_type is not None and treatment_type not in TREATMENT_TYPE_TO_EVENT_TYPE:
        return jsonify({
            "error": f"defaultTreatmentType invalide (attendu : {', '.join(TREATMENT_TYPE_TO_EVENT_TYPE)})"
        }), 400

    prefs = get_user_preferences(user_id)
    prefs.update({field: bool(data[field]) for field in BOOL_FIELDS if field in data})
    if treatment_type is not None:
        prefs["defaultTreatmentType"] = treatment_type

    cur = cursor_appifield()
    cur.execute(
        f"""INSERT INTO userPreferences (idUser, {', '.join(BOOL_FIELDS)}, defaultTreatmentType)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                {', '.join(f'{field} = VALUES({field})' for field in BOOL_FIELDS)},
                defaultTreatmentType = VALUES(defaultTreatmentType)""",
        (user_id, *(prefs[field] for field in BOOL_FIELDS), prefs["defaultTreatmentType"]),
    )
    commit_appifield()
    return jsonify(get_user_preferences(user_id))
