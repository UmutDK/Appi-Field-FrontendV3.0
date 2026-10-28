"""
Routes pour les traitements phytosanitaires.
Schéma DB : 3 tables normalisées (voir database/init_first_db.py) :
  - phytoTreatments            : l'événement (1 ligne par traitement)
  - phytoTreatmentsParcelsCrops: les parcelles/cultures concernées (N lignes)
  - phytoTreatmentsComposition : les produits appliqués (N lignes)
Tous les champs dérivés (surfaces/quantités/doses standardisées, répartition par
parcelle, totaux) sont calculés par app/utils/treatment_calc/, un module par mode de
saisie (Surface/Bouillie/Quantité), dispatché selon `eventType`. Le calcul est intégral
à chaque écriture (création ou modification) à partir des valeurs de base propres à
chaque mode — voir treatment_calc/__init__.py pour le détail du principe.
thirdPartFlag (0/1) : traitement effectué par un tiers — ses quantités ne sont pas
déduites de l'inventaire (filtrées dans app/utils/inventory_stock.py).
treatmentType : méthode d'application (pulvérisation, traitement de semences...), à ne
pas confondre avec eventType (mode d'encodage Surface/Bouillie/Quantité).
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, cursor_phytoweb, commit_appifield
from app.auth import require_auth
from app.utils.units import find_unit_name_by_id
from app.utils import treatment_calc
from app.utils.phytoweb_crops import resolve_index_crop_ids
from app.utils.user_preferences import get_user_preferences

bp = Blueprint("phyto_treatments", __name__, url_prefix="/phyto_treatments")

TREATMENT_TYPES = (
    "pulvérisation", "traitement de semences", "microgranulé", "arrosage",
    "irrigation", "badigeonnage", "injection", "trempage",
)
DEFAULT_TREATMENT_TYPE = "pulvérisation"


def _treatment_type_error(value):
    if value not in TREATMENT_TYPES:
        return jsonify({"error": f"treatmentType invalide (attendu : {', '.join(TREATMENT_TYPES)})"}), 400
    return None


def _attach_children(cur, events: list) -> list:
    for event in events:
        cur.execute(
            "SELECT * FROM phytoTreatmentsParcelsCrops WHERE eventId = %s AND userId = %s",
            (event["eventId"], event["userId"]),
        )
        parcels = cur.fetchall()
        for p in parcels:
            p["treatmentQuantityUnit"] = find_unit_name_by_id(p.get("treatmentQuantityUnitId"))
            p["surfaceTreatedUnit"] = find_unit_name_by_id(p.get("surfaceTreatedUnitId"))
        event["parcelsConcerned"] = parcels

        cur.execute(
            "SELECT * FROM phytoTreatmentsComposition WHERE eventId = %s AND userId = %s",
            (event["eventId"], event["userId"]),
        )
        composition = cur.fetchall()
        for c in composition:
            c["productDoseUnit"] = find_unit_name_by_id(c.get("productDoseUnitId"))
            c["productQuantityUnit"] = find_unit_name_by_id(c.get("productQuantityUnitId"))
        event["treatmentComposition"] = composition

        event["treatmentTotalQuantityUnit"] = find_unit_name_by_id(event.get("treatmentTotalQuantityUnitId"))
        event["treatmentTotalQuantityUsedUnit"] = find_unit_name_by_id(event.get("treatmentTotalQuantityUsedUnitId"))
    return events


def _fetch_full_treatment(cur, event_id, user_id):
    """Recharge un traitement avec ses enfants et unités résolues, pour le renvoyer
    intégralement calculé dans la réponse POST/PUT (le frontend s'y resynchronise au lieu
    de garder ses propres valeurs calculées côté client comme définitives)."""
    cur.execute("SELECT * FROM phytoTreatments WHERE eventId = %s AND userId = %s", (event_id, user_id))
    event = cur.fetchone()
    if not event:
        return None
    return _attach_children(cur, [event])[0]


def _load_existing_parcels(cur, event_id, user_id) -> list:
    """
    Recharge les parcelles existantes en base, dans la même forme que le payload attendu
    par treatment_calc.compute() (surfaceTreatedUnit = nom d'unité, ex. "ha"). Les lignes
    DB n'ont que surfaceTreatedUnitId (déjà résolu) : sans cette conversion, resolve_surface
    ne trouve pas d'unité, retombe sur le défaut parcelle (voire 0 si la parcelle n'existe
    plus) et écrase silencieusement une surface personnalisée à chaque update partiel.
    """
    cur.execute(
        "SELECT * FROM phytoTreatmentsParcelsCrops WHERE eventId = %s AND userId = %s",
        (event_id, user_id),
    )
    parcels = cur.fetchall()
    for p in parcels:
        p["surfaceTreatedUnit"] = find_unit_name_by_id(p.get("surfaceTreatedUnitId"))
    return parcels


def _load_existing_composition(cur, event_id, user_id) -> list:
    """Recharge la composition existante en base, avec les mêmes noms d'unité que le
    payload (productDoseUnit/productQuantityUnit) — même raison que _load_existing_parcels."""
    cur.execute(
        "SELECT * FROM phytoTreatmentsComposition WHERE eventId = %s AND userId = %s",
        (event_id, user_id),
    )
    composition = cur.fetchall()
    for c in composition:
        c["productDoseUnit"] = find_unit_name_by_id(c.get("productDoseUnitId"))
        c["productQuantityUnit"] = find_unit_name_by_id(c.get("productQuantityUnitId"))
    return composition


def _insert_parcels(cur, event_id, user_id, parcels: list):
    for p in parcels:
        cur.execute(
            """INSERT INTO phytoTreatmentsParcelsCrops
                (eventParcelsId, eventId, userId, parcelId, parcelName, cropId, cropName,
                 phytowebCropName, treatmentQuantity, treatmentQuantityUnitId, standardTreatmentQuantity,
                 surfaceTreated, surfaceTreatedUnitId, standardSurfaceTreated)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                str(uuid.uuid4()), event_id, user_id,
                p.get("parcelId"), p.get("parcelName"), p.get("cropId"), p.get("cropName"),
                p.get("phytowebCropName"),
                p.get("treatmentQuantity"), p.get("treatmentQuantityUnitId"), p.get("standardTreatmentQuantity"),
                p.get("surfaceTreated"), p.get("surfaceTreatedUnitId"), p.get("standardSurfaceTreated"),
            ),
        )


def _insert_composition(cur, event_id, user_id, composition: list):
    for c in composition:
        cur.execute(
            """INSERT INTO phytoTreatmentsComposition
                (eventCompositionId, eventId, userId, productId, productName, productNumAut,
                 productDose, productDoseUnitId, standardProductDose,
                 productQuantity, productQuantityUnitId, productTarget, standardProductQuantity)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                str(uuid.uuid4()), event_id, user_id,
                c.get("productId"), c.get("productName"), c.get("productNumAut"),
                c.get("productDose"), c.get("productDoseUnitId"), c.get("standardProductDose"),
                c.get("productQuantity"), c.get("productQuantityUnitId"), c.get("productTarget"),
                c.get("standardProductQuantity"),
            ),
        )


@bp.get("")
@require_auth
def get_treatments(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM phytoTreatments WHERE userId = %s ORDER BY eventDate DESC", (user_id,))
    events = cur.fetchall()
    return jsonify(_attach_children(cur, events))


ER_RI_WARNING_MESSAGE = (
    "Attention, ce produit ne semble pas autorisé dans le cadre de la campagne "
    "Eco-régime réduction d'intrants"
)
_MAX_WARNING_IDS = 100


def _split_ids(param: str | None) -> list[str]:
    """Liste d'ids séparés par des virgules, dédupliquée en conservant l'ordre."""
    ids = [i.strip() for i in (param or "").split(",") if i.strip()]
    return list(dict.fromkeys(ids))[:_MAX_WARNING_IDS]


@bp.get("/warnings")
@require_auth
def get_treatment_warnings(user_id):
    """
    Avertissements à afficher pendant l'encodage d'un traitement, déjà filtrés selon les
    préférences de l'utilisateur (userPreferences).
    Query : ?idActs=<idAct,...> (produits de la composition) &cropIds=<cropId,...> (cultures
    du traitement, ids c2544857c_appifield — rattachées au référentiel Phytoweb côté serveur,
    voir app/utils/phytoweb_crops.py). Les produits personnels (perso-...) sont ignorés.
      - erRiWarning  : general.erRiFlag = 1 ET préférence erRiWarningFlag = 1
      - hourWarning  : general.spe8FlagHoraire = 1 ET préférence spe8HourWarningFlag = 1
      - bbchWarnings : lignes corderPhytoweb.crops de l'acte avec bbchFlag = 1 dont l'idCrop
                       correspond à une culture du traitement, ET préférence bbchWarningFlag = 1
    Les valeurs brutes (erRiFlag, spe8FlagHoraire, bbchCrops) sont renvoyées indépendamment
    des préférences.
    """
    prefs = get_user_preferences(user_id)
    id_acts = [i for i in _split_ids(request.args.get("idActs")) if not i.startswith("perso-")]
    crop_ids = _split_ids(request.args.get("cropIds"))

    # Cultures du traitement -> idCrop du référentiel Phytoweb
    crop_ids_by_index_id: dict[str, list[str]] = {}
    unresolved_crop_ids = []
    if crop_ids:
        cur = cursor_appifield()
        placeholders = ", ".join(["%s"] * len(crop_ids))
        cur.execute(
            f"SELECT cropId, phytowebId FROM crops WHERE userId = %s AND cropId IN ({placeholders})",
            (user_id, *crop_ids),
        )
        phytoweb_id_by_crop = {row["cropId"]: row["phytowebId"] for row in cur.fetchall()}
        index_ids = resolve_index_crop_ids(phytoweb_id_by_crop.values())
        for crop_id in crop_ids:
            index_id = index_ids.get(phytoweb_id_by_crop.get(crop_id))
            if index_id:
                crop_ids_by_index_id.setdefault(index_id, []).append(crop_id)
            else:
                unresolved_crop_ids.append(crop_id)

    products = []
    if id_acts:
        cur_ph = cursor_phytoweb()
        placeholders = ", ".join(["%s"] * len(id_acts))
        cur_ph.execute(
            f"""SELECT idAct, productName, numAut, erRiFlag, spe8FlagHoraire
                FROM general WHERE idAct IN ({placeholders})""",
            tuple(id_acts),
        )
        general_by_act = {row["idAct"]: row for row in cur_ph.fetchall()}

        bbch_by_act: dict[str, list[dict]] = {}
        if crop_ids_by_index_id:
            index_placeholders = ", ".join(["%s"] * len(crop_ids_by_index_id))
            cur_ph.execute(
                f"""SELECT idAct, idCrop, cropName, cropApplicationStade
                    FROM crops
                    WHERE bbchFlag = '1' AND idAct IN ({placeholders}) AND idCrop IN ({index_placeholders})""",
                (*id_acts, *crop_ids_by_index_id.keys()),
            )
            seen = set()
            for row in cur_ph.fetchall():
                key = (row["idAct"], row["idCrop"], row["cropApplicationStade"])
                if key in seen:  # une même culture peut apparaître sur plusieurs lignes de l'acte
                    continue
                seen.add(key)
                bbch_by_act.setdefault(row["idAct"], []).append({
                    "idCrop": row["idCrop"],
                    "cropName": row["cropName"],
                    "cropApplicationStade": row["cropApplicationStade"],
                    "cropIds": crop_ids_by_index_id[row["idCrop"]],
                    "message": f"{row['cropName']} : {row['cropApplicationStade']}",
                })

        for id_act in id_acts:
            general = general_by_act.get(id_act)
            if not general:
                continue
            er_ri = str(general.get("erRiFlag")) == "1"
            spe8_hour = str(general.get("spe8FlagHoraire")) == "1"
            bbch_crops = bbch_by_act.get(id_act, [])
            products.append({
                "idAct": id_act,
                "productName": general["productName"],
                "numAut": general["numAut"],
                "erRiFlag": er_ri,
                "spe8FlagHoraire": spe8_hour,
                "bbchCrops": bbch_crops,
                "erRiWarning": ER_RI_WARNING_MESSAGE if er_ri and prefs["erRiWarningFlag"] else None,
                "hourWarning": spe8_hour and prefs["spe8HourWarningFlag"],
                "bbchWarnings": bbch_crops if prefs["bbchWarningFlag"] else [],
            })

    return jsonify({
        "preferences": prefs,
        "products": products,
        "unresolvedCropIds": unresolved_crop_ids,
    })


@bp.get("/<event_id>")
@require_auth
def get_treatment(user_id, event_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM phytoTreatments WHERE eventId = %s AND userId = %s", (event_id, user_id))
    event = cur.fetchone()
    if not event:
        return jsonify({"error": "Traitement non trouvé"}), 404
    return jsonify(_attach_children(cur, [event])[0])


@bp.post("")
@require_auth
def create_treatment(user_id):
    data = request.get_json(force=True)
    if not data.get("eventType"):
        return jsonify({"error": "eventType requis"}), 400
    if not data.get("eventDate"):
        return jsonify({"error": "eventDate requis"}), 400
    treatment_type = data.get("treatmentType") or DEFAULT_TREATMENT_TYPE
    error = _treatment_type_error(treatment_type)
    if error:
        return error
    event_id = data.get("eventId") or str(uuid.uuid4())

    cur = cursor_appifield()
    treatment_fields, parcels_out, composition_out = treatment_calc.compute(
        data.get("eventType"), cur, user_id, data,
        data.get("parcelsConcerned", []), data.get("treatmentComposition", []),
    )

    cur.execute(
        """INSERT INTO phytoTreatments
            (eventId, userId, eventType, eventDate, eventTime, operatorId,
             treatmentTotalQuantity, treatmentTotalQuantityUnitId, standardTreatmentTotalQuantity,
             treatmentTotalQuantityUsed, treatmentTotalQuantityUsedUnitId, standardTreatmentTotalQuantityUsed,
             surfaceTreated, standardSurfaceTreated,
             remarks, cleanFlag, localizedTreatment, decisionBase, effectiveness, thirdPartFlag,
             treatmentType)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            event_id, user_id, data.get("eventType"),
            data.get("eventDate"), data.get("eventTime"), data.get("operatorId"),
            treatment_fields["treatmentTotalQuantity"], treatment_fields["treatmentTotalQuantityUnitId"],
            treatment_fields["standardTreatmentTotalQuantity"],
            treatment_fields["treatmentTotalQuantityUsed"], treatment_fields["treatmentTotalQuantityUsedUnitId"],
            treatment_fields["standardTreatmentTotalQuantityUsed"],
            treatment_fields["surfaceTreated"], treatment_fields["standardSurfaceTreated"],
            data.get("remarks"), bool(data.get("cleanFlag")), bool(data.get("localizedTreatment")),
            data.get("decisionBase"), data.get("effectiveness"), bool(data.get("thirdPartFlag")),
            treatment_type,
        ),
    )
    _insert_parcels(cur, event_id, user_id, parcels_out)
    _insert_composition(cur, event_id, user_id, composition_out)
    commit_appifield()

    treatment = _fetch_full_treatment(cur, event_id, user_id) or {}
    return jsonify({**treatment, "success": True, "eventId": event_id}), 201


@bp.put("/<event_id>")
@require_auth
def update_treatment(user_id, event_id):
    data = request.get_json(force=True)
    cur = cursor_appifield()

    # Le calcul a besoin de l'état complet parcelles+composition : si le payload n'envoie
    # que des champs top-level (ex. juste `remarks`), on recharge l'existant en base pour
    # que le recalcul intégral reste correct.
    parcels_in = data["parcelsConcerned"] if "parcelsConcerned" in data else _load_existing_parcels(cur, event_id, user_id)
    composition_in = data["treatmentComposition"] if "treatmentComposition" in data else _load_existing_composition(cur, event_id, user_id)

    cur.execute(
        "SELECT eventType, thirdPartFlag, treatmentType FROM phytoTreatments WHERE eventId = %s AND userId = %s",
        (event_id, user_id),
    )
    existing = cur.fetchone() or {}
    event_type = data.get("eventType") or existing.get("eventType")
    # Omis du payload -> on conserve la valeur actuelle (un oubli côté client ne doit pas
    # réintégrer silencieusement un traitement de tiers dans l'inventaire).
    third_part_flag = bool(data["thirdPartFlag"]) if "thirdPartFlag" in data else bool(existing.get("thirdPartFlag"))
    treatment_type = data.get("treatmentType") or existing.get("treatmentType") or DEFAULT_TREATMENT_TYPE
    error = _treatment_type_error(treatment_type)
    if error:
        return error

    treatment_fields, parcels_out, composition_out = treatment_calc.compute(
        event_type, cur, user_id, data, parcels_in, composition_in,
    )

    cur.execute(
        """UPDATE phytoTreatments SET eventType = %s, eventDate = %s, eventTime = %s,
           operatorId = %s,
           treatmentTotalQuantity = %s, treatmentTotalQuantityUnitId = %s, standardTreatmentTotalQuantity = %s,
           treatmentTotalQuantityUsed = %s, treatmentTotalQuantityUsedUnitId = %s, standardTreatmentTotalQuantityUsed = %s,
           surfaceTreated = %s, standardSurfaceTreated = %s,
           remarks = %s, cleanFlag = %s, localizedTreatment = %s, decisionBase = %s, effectiveness = %s,
           thirdPartFlag = %s, treatmentType = %s
           WHERE eventId = %s AND userId = %s""",
        (
            event_type, data.get("eventDate"), data.get("eventTime"), data.get("operatorId"),
            treatment_fields["treatmentTotalQuantity"], treatment_fields["treatmentTotalQuantityUnitId"],
            treatment_fields["standardTreatmentTotalQuantity"],
            treatment_fields["treatmentTotalQuantityUsed"], treatment_fields["treatmentTotalQuantityUsedUnitId"],
            treatment_fields["standardTreatmentTotalQuantityUsed"],
            treatment_fields["surfaceTreated"], treatment_fields["standardSurfaceTreated"],
            data.get("remarks"), bool(data.get("cleanFlag")), bool(data.get("localizedTreatment")),
            data.get("decisionBase"), data.get("effectiveness"), third_part_flag, treatment_type,
            event_id, user_id,
        ),
    )

    cur.execute("DELETE FROM phytoTreatmentsParcelsCrops WHERE eventId = %s AND userId = %s", (event_id, user_id))
    _insert_parcels(cur, event_id, user_id, parcels_out)

    cur.execute("DELETE FROM phytoTreatmentsComposition WHERE eventId = %s AND userId = %s", (event_id, user_id))
    _insert_composition(cur, event_id, user_id, composition_out)

    commit_appifield()
    treatment = _fetch_full_treatment(cur, event_id, user_id) or {}
    return jsonify({**treatment, "success": True})


@bp.delete("/<event_id>")
@require_auth
def delete_treatment(user_id, event_id):
    cur = cursor_appifield()
    cur.execute("DELETE FROM phytoTreatmentsComposition WHERE eventId = %s AND userId = %s", (event_id, user_id))
    cur.execute("DELETE FROM phytoTreatmentsParcelsCrops WHERE eventId = %s AND userId = %s", (event_id, user_id))
    cur.execute("DELETE FROM phytoTreatments WHERE eventId = %s AND userId = %s", (event_id, user_id))
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<event_id>/parcel/<parcel_id>")
@require_auth
def remove_parcel_from_treatment(user_id, event_id, parcel_id):
    """Retire une parcelle des phytoTreatmentsParcelsCrops d'un traitement."""
    cur = cursor_appifield()
    cur.execute(
        "DELETE FROM phytoTreatmentsParcelsCrops WHERE eventId = %s AND userId = %s AND parcelId = %s",
        (event_id, user_id, parcel_id),
    )
    commit_appifield()
    return jsonify({"success": True})
