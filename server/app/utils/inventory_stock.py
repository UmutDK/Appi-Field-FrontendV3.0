"""
Agrégation des mouvements de stock par produit, partagée par GET /inventories
et l'export inventaire (app/utils/exports.py).

Deux sources combinées, fusionnées et triées chronologiquement :
- inventoriesOperations : uniquement les mouvements saisis par l'utilisateur,
  achat/ajout ('purchase', +) ou déclaration réglementaire ('ppnu'/'ppnv', suivies
  à part dans ppnuStock/ppnvStock, jamais comptées dans le stock utilisable).
- phytoTreatmentsComposition : la consommation par traitement phytosanitaire (-),
  lue directement depuis cette table (jointe à phytoTreatments pour la date) —
  jamais dupliquée dans inventoriesOperations.
"""
from app.db import cursor_appifield
from app.utils.units import find_unit_name_by_id


def _new_entry(product_id: str) -> dict:
    return {
        "productId": product_id, "productName": None, "productNumAut": None,
        "stock": 0.0, "ppnuStock": 0.0, "ppnvStock": 0.0, "operations": [],
    }


def compute_stock_by_product(user_id: str) -> list[dict]:
    """Retourne, par produit, le stock courant et l'historique combiné des mouvements."""
    cur = cursor_appifield()

    cur.execute(
        "SELECT * FROM inventoriesOperations WHERE userId = %s ORDER BY operationDate", (user_id,)
    )
    operations = cur.fetchall()

    cur.execute(
        """SELECT c.eventCompositionId, c.eventId, c.productId, c.productName, c.productNumAut,
                  c.productQuantity, c.productQuantityUnitId, c.standardProductQuantity, t.eventDate
           FROM phytoTreatmentsComposition c
           JOIN phytoTreatments t ON t.eventId = c.eventId AND t.userId = c.userId
           WHERE c.userId = %s""",
        (user_id,),
    )
    treatment_usages = cur.fetchall()

    by_product: dict[str, dict] = {}

    for op in operations:
        op["quantityUnit"] = find_unit_name_by_id(op.get("quantityUnitId"))
        entry = by_product.setdefault(op["productId"], _new_entry(op["productId"]))
        entry["operations"].append(op)

        qty = op.get("standardQuantity")
        if qty is None:
            qty = op.get("quantity") or 0

        op_type = op["operationType"]
        if op_type == "ppnu":
            entry["ppnuStock"] += qty
        elif op_type == "ppnv":
            entry["ppnvStock"] += qty
        else:
            entry["stock"] += qty  # 'purchase' : ajout

    for usage in treatment_usages:
        product_id = usage.get("productId")
        if not product_id:
            continue
        entry = by_product.setdefault(product_id, _new_entry(product_id))
        if not entry["productName"] and usage.get("productName"):
            entry["productName"] = usage["productName"]
            entry["productNumAut"] = usage.get("productNumAut")

        qty = usage.get("standardProductQuantity")
        if qty is None:
            qty = usage.get("productQuantity") or 0
        entry["stock"] -= qty

        entry["operations"].append({
            "inventoryOperationId": usage["eventCompositionId"],
            "productId": product_id,
            "operationType": "treatment",
            "operationDate": usage["eventDate"],
            "quantity": usage.get("productQuantity"),
            "quantityUnitId": usage.get("productQuantityUnitId"),
            "quantityUnit": find_unit_name_by_id(usage.get("productQuantityUnitId")),
            "standardQuantity": usage.get("standardProductQuantity"),
            "sourceEventId": usage["eventId"],
        })

    for entry in by_product.values():
        entry["operations"].sort(key=lambda o: o.get("operationDate") or "")

    return list(by_product.values())
