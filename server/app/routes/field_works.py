"""
Routes pour les travaux aux champs.
Schéma DB : 2 tables normalisées (voir database/init_first_db.py) :
  - fieldWorks            : l'événement (1 ligne par travail)
  - fieldWorksParcelsCrops: les parcelles/cultures concernées (N lignes)
L'unité de dose (eventDoseUnit, nom ex. "L/ha") est résolue en idUnit avec calcul
de la valeur standardisée (standardEventDose), à l'écriture.
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth
from app.utils.units import resolve_and_standardize, find_unit_name_by_id

bp = Blueprint("field_works", __name__, url_prefix="/field_works")


def _attach_parcels(cur, events: list) -> list:
    for event in events:
        cur.execute(
            "SELECT * FROM fieldWorksParcelsCrops WHERE eventId = %s AND userId = %s",
            (event["eventId"], event["userId"]),
        )
        event["parcelsConcerned"] = cur.fetchall()
        event["eventDoseUnit"] = find_unit_name_by_id(event.get("eventDoseUnitId"))
    return events


def _insert_parcels(cur, event_id, user_id, parcels: list):
    for p in parcels:
        cur.execute(
            """INSERT INTO fieldWorksParcelsCrops
                (eventParcelsId, eventId, userId, parcelId, parcelName, cropId, cropName, phytowebCropName)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                str(uuid.uuid4()), event_id, user_id,
                p.get("parcelId"), p.get("parcelName"), p.get("cropId"), p.get("cropName"),
                p.get("phytowebCropName"),
            ),
        )


@bp.get("")
@require_auth
def get_field_works(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM fieldWorks WHERE userId = %s ORDER BY eventDate DESC", (user_id,))
    events = cur.fetchall()
    return jsonify(_attach_parcels(cur, events))


@bp.get("/<event_id>")
@require_auth
def get_field_work(user_id, event_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM fieldWorks WHERE eventId = %s AND userId = %s", (event_id, user_id))
    event = cur.fetchone()
    if not event:
        return jsonify({"error": "Travail au champ non trouvé"}), 404
    return jsonify(_attach_parcels(cur, [event])[0])


@bp.post("")
@require_auth
def create_field_work(user_id):
    data = request.get_json(force=True)
    if not data.get("eventType"):
        return jsonify({"error": "eventType requis"}), 400
    if not data.get("eventDate"):
        return jsonify({"error": "eventDate requis"}), 400
    event_id = data.get("eventId") or str(uuid.uuid4())
    dose = data.get("eventDose")
    unit_id, standard_dose = resolve_and_standardize(dose, data.get("eventDoseUnit"))

    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO fieldWorks
            (eventId, userId, eventType, eventDate, eventInfo, remarks,
             eventDose, eventDoseUnitId, standardEventDose, eventTool)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            event_id, user_id, data.get("eventType"), data.get("eventDate"),
            data.get("eventInfo"), data.get("remarks"), dose, unit_id, standard_dose, data.get("eventTool"),
        ),
    )
    _insert_parcels(cur, event_id, user_id, data.get("parcelsConcerned", []))
    commit_appifield()
    return jsonify({"success": True, "eventId": event_id}), 201


@bp.put("/<event_id>")
@require_auth
def update_field_work(user_id, event_id):
    data = request.get_json(force=True)
    dose = data.get("eventDose")
    unit_id, standard_dose = resolve_and_standardize(dose, data.get("eventDoseUnit"))

    cur = cursor_appifield()
    cur.execute(
        """UPDATE fieldWorks SET eventType = %s, eventDate = %s, eventInfo = %s,
           remarks = %s, eventDose = %s, eventDoseUnitId = %s, standardEventDose = %s, eventTool = %s
           WHERE eventId = %s AND userId = %s""",
        (
            data.get("eventType"), data.get("eventDate"), data.get("eventInfo"),
            data.get("remarks"), dose, unit_id, standard_dose, data.get("eventTool"), event_id, user_id,
        ),
    )

    if "parcelsConcerned" in data:
        cur.execute("DELETE FROM fieldWorksParcelsCrops WHERE eventId = %s AND userId = %s", (event_id, user_id))
        _insert_parcels(cur, event_id, user_id, data["parcelsConcerned"])

    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<event_id>")
@require_auth
def delete_field_work(user_id, event_id):
    cur = cursor_appifield()
    cur.execute("DELETE FROM fieldWorksParcelsCrops WHERE eventId = %s AND userId = %s", (event_id, user_id))
    cur.execute("DELETE FROM fieldWorks WHERE eventId = %s AND userId = %s", (event_id, user_id))
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<event_id>/parcel/<parcel_id>")
@require_auth
def remove_parcel_from_field_work(user_id, event_id, parcel_id):
    """Retire une parcelle des fieldWorksParcelsCrops d'un travail au champ."""
    cur = cursor_appifield()
    cur.execute(
        "DELETE FROM fieldWorksParcelsCrops WHERE eventId = %s AND userId = %s AND parcelId = %s",
        (event_id, user_id, parcel_id),
    )
    commit_appifield()
    return jsonify({"success": True})
