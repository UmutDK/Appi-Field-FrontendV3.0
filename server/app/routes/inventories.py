"""
Routes pour l'inventaire de produits.
Schéma DB : table `inventoriesOperations` (voir database/init_first_db.py), à plat —
chaque ligne est un mouvement saisi par l'utilisateur : achat/ajout ('purchase', +)
ou déclaration réglementaire ('ppnu'/'ppnv', -, suivies à part du stock utilisable).
La consommation par traitement phytosanitaire n'est PAS stockée ici : GET /inventories
la lit en direct depuis phytoTreatmentsComposition (voir app/utils/inventory_stock.py),
pour ne jamais la dupliquer. Le stock courant n'est pas stocké séparément : il est
calculé à la volée par produit à partir de ces deux sources combinées.
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth
from app.utils.units import resolve_and_standardize
from app.utils.inventory_stock import compute_stock_by_product

bp = Blueprint("inventories", __name__, url_prefix="/inventories")


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
    Body attendu : { productId, operationType, operationDate, quantity, quantityUnit }
    """
    data = request.get_json(force=True)
    product_id = data.get("productId")
    if not product_id:
        return jsonify({"error": "productId requis"}), 400

    quantity = data.get("quantity")
    unit_id, standard_qty = resolve_and_standardize(quantity, data.get("quantityUnit"))

    operation_id = str(uuid.uuid4())
    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO inventoriesOperations
            (inventoryOperationId, userId, productId, operationType,
             operationDate, quantity, quantityUnitId, standardQuantity)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            operation_id, user_id, product_id,
            data.get("operationType"), data.get("operationDate"), quantity, unit_id, standard_qty,
        ),
    )
    commit_appifield()
    return jsonify({"success": True, "inventoryOperationId": operation_id}), 201


@bp.put("/<operation_id>")
@require_auth
def update_inventory_operation(user_id, operation_id):
    """
    Modifie un mouvement de stock existant.
    Body attendu : { productId?, operationType?, operationDate?, quantity?, quantityUnit? }
    — mêmes champs que POST, tous optionnels (les champs omis conservent leur valeur actuelle).
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
    unit_name = data.get("quantityUnit")
    if unit_name is not None:
        unit_id, standard_qty = resolve_and_standardize(quantity, unit_name)
    else:
        unit_id, standard_qty = existing["quantityUnitId"], existing["standardQuantity"]

    cur.execute(
        """UPDATE inventoriesOperations
           SET productId = %s, operationType = %s, operationDate = %s,
               quantity = %s, quantityUnitId = %s, standardQuantity = %s
           WHERE inventoryOperationId = %s AND userId = %s""",
        (product_id, operation_type, operation_date,
         quantity, unit_id, standard_qty, operation_id, user_id),
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
