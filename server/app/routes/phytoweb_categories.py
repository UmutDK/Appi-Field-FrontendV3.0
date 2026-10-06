"""
Catégories de cultures Phytoweb : référentiel `indexCrop` (c2544857c_corderPhytoweb,
lecture seule) fusionné avec la couche de surcharge admin (table `phytowebCategoryOverrides`
dans c2544857c_appifield : visibilité des catégories initiales + catégories personnalisées).
Remplace previousServer/phytoweb_categories_manager.php.

Contrairement à l'ancien système (index/phytoweb_crops.json avec EPPOCode/hierarchy_id_list),
le référentiel réel (cf. server/DOCUMENTATION_CorderPhytoweb.md) n'expose que idCrop/cropName
pour indexCrop — ces deux champs n'ont donc pas d'équivalent upstream ; ils restent
disponibles uniquement sur les catégories personnalisées (saisis par l'admin).
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, cursor_phytoweb, commit_appifield
from app.auth import require_auth, require_admin

bp = Blueprint("phytoweb_categories", __name__, url_prefix="/phytoweb_categories")


@bp.get("")
@require_auth
def get_category_overrides(user_id):
    """Fusionne le catalogue Phytoweb (indexCrop) avec les surcharges admin."""
    cur_phytoweb = cursor_phytoweb()
    cur_phytoweb.execute("SELECT idCrop, cropName FROM indexCrop ORDER BY cropName")
    base_crops = cur_phytoweb.fetchall()

    cur = cursor_appifield()
    cur.execute("SELECT * FROM phytowebCategoryOverrides")
    overrides_by_crop_id = {row["cropId"]: row for row in cur.fetchall()}

    categories = []
    for crop in base_crops:
        override = overrides_by_crop_id.pop(crop["idCrop"], None)
        categories.append({
            "cropId": crop["idCrop"],
            "initialCropId": crop["idCrop"],
            "nameFr": crop["cropName"],
            "visibleStatut": bool(override["visibleStatut"]) if override else True,
        })

    # Ce qui reste dans overrides_by_crop_id : les catégories personnalisées (cropId != initialCropId).
    categories.extend(overrides_by_crop_id.values())

    return jsonify(categories)


@bp.post("")
@require_admin
def create_category_override(user_id):
    data = request.get_json(force=True)
    name_fr = (data.get("nameFr") or "").strip()
    initial_crop_id = (data.get("initialCropId") or "").strip()
    if not name_fr:
        return jsonify({"error": "nameFr requis"}), 400
    if not initial_crop_id:
        return jsonify({"error": "initialCropId requis"}), 400

    crop_id = "pwc-" + str(uuid.uuid4())
    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO phytowebCategoryOverrides
            (cropId, initialCropId, nameFr, eppoCode, hierarchyIdList, visibleStatut)
           VALUES (%s, %s, %s, %s, %s, 1)""",
        (crop_id, initial_crop_id, name_fr, data.get("eppoCode", ""), data.get("hierarchyIdList", "")),
    )
    commit_appifield()
    return jsonify({"success": True, "cropId": crop_id}), 201


@bp.put("/<crop_id>")
@require_admin
def update_category_override(user_id, crop_id):
    """
    Une catégorie 'initiale' (cropId == initialCropId) n'accepte que visibleStatut.
    Une catégorie personnalisée accepte nameFr et/ou visibleStatut.
    """
    data = request.get_json(force=True)
    has_name = "nameFr" in data and (data.get("nameFr") or "").strip() != ""
    has_visible = "visibleStatut" in data
    if not has_name and not has_visible:
        return jsonify({"error": "nameFr ou visibleStatut requis"}), 400

    cur = cursor_appifield()
    cur.execute("SELECT * FROM phytowebCategoryOverrides WHERE cropId = %s", (crop_id,))
    category = cur.fetchone()
    if not category:
        return jsonify({"error": "Catégorie non trouvée"}), 404

    is_initial = category["cropId"] == category["initialCropId"]
    if is_initial and has_name:
        return jsonify({"error": "Impossible de modifier le nom d'une catégorie initiale"}), 403

    new_name = data["nameFr"].strip() if has_name else category["nameFr"]
    new_visible = bool(data["visibleStatut"]) if has_visible else category["visibleStatut"]
    cur.execute(
        "UPDATE phytowebCategoryOverrides SET nameFr = %s, visibleStatut = %s WHERE cropId = %s",
        (new_name, new_visible, crop_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<crop_id>")
@require_admin
def delete_category_override(user_id, crop_id):
    cur = cursor_appifield()
    cur.execute("SELECT cropId, initialCropId FROM phytowebCategoryOverrides WHERE cropId = %s", (crop_id,))
    category = cur.fetchone()
    if not category:
        return jsonify({"error": "Catégorie non trouvée"}), 404
    if category["cropId"] == category["initialCropId"]:
        return jsonify({"error": "Impossible de supprimer une catégorie initiale"}), 403

    cur.execute("DELETE FROM phytowebCategoryOverrides WHERE cropId = %s", (crop_id,))
    commit_appifield()
    return jsonify({"success": True})
