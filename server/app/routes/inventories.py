"""
Routes pour l'inventaire de produits.
Schéma DB : table `inventoriesOperations` (voir database/init_first_db.py), à plat —
chaque ligne est un mouvement saisi par l'utilisateur : achat/ajout ('purchase', +),
déclaration réglementaire ('ppnu'/'ppnv', -, suivies à part du stock utilisable) ou
correction de stock ('correction', + ou - selon correctionMode 'plus'/'minus').
La consommation par traitement phytosanitaire n'est PAS stockée ici : GET /inventories
la lit en direct depuis phytoTreatmentsComposition (voir app/utils/inventory_stock.py),
pour ne jamais la dupliquer. Le stock courant n'est pas stocké séparément : il est
calculé à la volée par produit à partir de ces deux sources combinées.
"""
import uuid
from flask import Blueprint, jsonify, request, send_file
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth
from app.utils.units import resolve_and_standardize, find_unit_name_by_id
from app.utils.inventory_stock import compute_stock_by_product
from app.utils.inventory_import import (
    MAX_FILE_SIZE, ImportFileError, build_template, preview_import, validate_confirm_rows,
)

bp = Blueprint("inventories", __name__, url_prefix="/inventories")

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# 'treatment' n'est jamais créé ici : il vient de phytoTreatmentsComposition.
OPERATION_TYPES = ("purchase", "ppnu", "ppnv", "correction")
CORRECTION_MODES = ("plus", "minus")


def _validate_operation(operation_type, quantity, correction_mode):
    """
    Valide un mouvement (après fusion avec l'existant pour PUT).
    Retourne (correction_mode normalisé, message d'erreur ou None) — correction_mode
    vaut None pour tout type autre que 'correction'.
    """
    if operation_type not in OPERATION_TYPES:
        return None, f"operationType invalide (attendu : {', '.join(OPERATION_TYPES)})"
    try:
        if quantity is None or float(quantity) <= 0:
            return None, "quantity doit être supérieure à 0"
    except (TypeError, ValueError):
        return None, "quantity doit être un nombre"
    if operation_type != "correction":
        return None, None
    if correction_mode not in CORRECTION_MODES:
        return None, "correctionMode requis pour une correction ('plus' ou 'minus')"
    return correction_mode, None


def _insert_operation(user_id, product_id, operation_type, operation_date,
                      quantity, unit_name, correction_mode=None) -> str:
    """Insère un mouvement (sans commit) et retourne son id. Partagé par POST /inventories et l'import."""
    unit_id, standard_qty = resolve_and_standardize(quantity, unit_name)
    operation_id = str(uuid.uuid4())
    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO inventoriesOperations
            (inventoryOperationId, userId, productId, operationType,
             operationDate, quantity, quantityUnitId, standardQuantity, correctionMode)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            operation_id, user_id, product_id,
            operation_type, operation_date, quantity, unit_id, standard_qty,
            correction_mode,
        ),
    )
    return operation_id


@bp.get("")
@require_auth
def get_inventories(user_id):
    """Retourne, par produit, le stock courant et l'historique des mouvements."""
    return jsonify(compute_stock_by_product(user_id))


@bp.post("")
@require_auth
def add_inventory_operation(user_id):
    """
    Ajoute un mouvement de stock.
    Body attendu : { productId, operationType, operationDate, quantity, quantityUnit,
                     correctionMode? } — correctionMode ('plus'/'minus') requis si
    operationType = 'correction', ignoré sinon. quantity toujours > 0.
    """
    data = request.get_json(force=True)
    product_id = data.get("productId")
    if not product_id:
        return jsonify({"error": "productId requis"}), 400

    operation_type = data.get("operationType")
    quantity = data.get("quantity")
    correction_mode, error = _validate_operation(operation_type, quantity, data.get("correctionMode"))
    if error:
        return jsonify({"error": error}), 400

    operation_id = _insert_operation(
        user_id, product_id, operation_type, data.get("operationDate"),
        quantity, data.get("quantityUnit"), correction_mode,
    )
    commit_appifield()
    return jsonify({"success": True, "inventoryOperationId": operation_id}), 201


@bp.get("/import/template")
@require_auth
def get_import_template(user_id):
    """Modèle Excel vierge pour l'import d'achats."""
    return send_file(build_template(), mimetype=_XLSX_MIME, as_attachment=True,
                     download_name="modele_import_achats.xlsx")


@bp.post("/import/preview")
@require_auth
def preview_purchases_import(user_id):
    """
    Lit et valide un fichier d'import (multipart, champ 'file') sans rien enregistrer.
    Retourne chaque ligne avec le produit reconnu (via le numéro d'autorisation), les valeurs
    normalisées, les erreurs/avertissements par champ et des suggestions de produits.
    """
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Aucun fichier fourni"}), 400
    if not uploaded.filename.lower().endswith(".xlsx"):
        return jsonify({"error": "Le fichier doit être au format .xlsx"}), 400
    file_bytes = uploaded.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        return jsonify({"error": "Le fichier est trop volumineux (max 2 Mo)"}), 400
    try:
        return jsonify(preview_import(user_id, file_bytes))
    except ImportFileError as e:
        return jsonify({"error": str(e)}), 400


@bp.post("/import/confirm")
@require_auth
def confirm_purchases_import(user_id):
    """
    Enregistre les achats validés dans la popup (après résolution des conflits).
    Body : { rows: [{ rowNumber?, productId, quantity, quantityUnit: 'L'|'Kg', operationDate: 'YYYY-MM-DD' }] }
    Tout ou rien : si une ligne est invalide, rien n'est enregistré (400 avec le détail par ligne).
    """
    data = request.get_json(force=True) or {}
    valid_rows, errors = validate_confirm_rows(data.get("rows"))
    if errors:
        return jsonify({"error": "Certaines lignes sont invalides, aucun achat n'a été importé",
                        "rowErrors": errors}), 400

    operation_ids = [
        _insert_operation(user_id, row["productId"], "purchase", row["operationDate"],
                          row["quantity"], row["quantityUnit"])
        for row in valid_rows
    ]
    commit_appifield()
    return jsonify({"success": True, "created": len(operation_ids),
                    "inventoryOperationIds": operation_ids}), 201


@bp.put("/<operation_id>")
@require_auth
def update_inventory_operation(user_id, operation_id):
    """
    Modifie un mouvement de stock existant.
    Body attendu : { productId?, operationType?, operationDate?, quantity?, quantityUnit?,
                     correctionMode? }
    — mêmes champs que POST, tous optionnels (les champs omis conservent leur valeur actuelle).
    Le mouvement fusionné est revalidé comme en POST (correctionMode remis à NULL si le
    type n'est plus 'correction').
    """
    cur = cursor_appifield()
    cur.execute(
        "SELECT * FROM inventoriesOperations WHERE inventoryOperationId = %s AND userId = %s",
        (operation_id, user_id),
    )
    existing = cur.fetchone()
    if not existing:
        return jsonify({"error": "Mouvement d'inventaire non trouvé"}), 404

    data = request.get_json(force=True)
    product_id = data.get("productId", existing["productId"])
    operation_type = data.get("operationType", existing["operationType"])
    operation_date = data.get("operationDate", existing["operationDate"])

    quantity = data.get("quantity", existing["quantity"])
    correction_mode, error = _validate_operation(
        operation_type, quantity, data.get("correctionMode", existing.get("correctionMode"))
    )
    if error:
        return jsonify({"error": error}), 400

    unit_name = data.get("quantityUnit")
    if unit_name is not None:
        unit_id, standard_qty = resolve_and_standardize(quantity, unit_name)
    elif "quantity" in data:
        # Quantité modifiée sans unité : on restandardise avec l'unité existante, sinon
        # standardQuantity (utilisée pour le stock) garderait l'ancienne valeur.
        unit_id = existing["quantityUnitId"]
        _, standard_qty = resolve_and_standardize(quantity, find_unit_name_by_id(unit_id))
    else:
        unit_id, standard_qty = existing["quantityUnitId"], existing["standardQuantity"]

    cur.execute(
        """UPDATE inventoriesOperations
           SET productId = %s, operationType = %s, operationDate = %s,
               quantity = %s, quantityUnitId = %s, standardQuantity = %s, correctionMode = %s
           WHERE inventoryOperationId = %s AND userId = %s""",
        (product_id, operation_type, operation_date,
         quantity, unit_id, standard_qty, correction_mode, operation_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("")
@require_auth
def delete_inventory_operation(user_id):
    """
    Supprime un mouvement de stock.
    Query param : ?inventoryOperationId=<id>
    """
    operation_id = request.args.get("inventoryOperationId")
    if not operation_id:
        return jsonify({"error": "inventoryOperationId requis"}), 400

    cur = cursor_appifield()
    cur.execute(
        "DELETE FROM inventoriesOperations WHERE inventoryOperationId = %s AND userId = %s",
        (operation_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})
