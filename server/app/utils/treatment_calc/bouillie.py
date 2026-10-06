"""
Mode Bouillie : l'utilisateur fixe le volume de bouillie préparé/utilisé (treatmentTotal
Quantity/treatmentTotalQuantityUsed) et la dose de chaque produit (par 100L/10L de
bouillie). La quantité de bouillie par parcelle (treatmentQuantity) respecte la répartition
choisie par l'utilisateur (étape "Répartition" du frontend, sliders/verrouillage) quand elle
est fournie ; à défaut (parcelle jamais touchée, valeur nulle/zéro), elle est répartie au
prorata de la surface traitée.
"""
from app.utils.units import resolve_and_standardize
from .common import resolve_surface, mass_or_volume_unit_id, sum_standardized_by_unit


def compute(cur, user_id, treatment_data, parcels_in, composition_in):
    # 1. Surface par parcelle, puis surface totale du traitement (identique au mode Surface)
    parcels_out = []
    total_standard_surface = 0.0
    for p in parcels_in:
        surface, surface_unit_id, standard_surface = resolve_surface(
            cur, user_id, p.get("parcelId"), p.get("surfaceTreated"), p.get("surfaceTreatedUnit")
        )
        standard_surface = standard_surface or 0.0
        total_standard_surface += standard_surface
        parcels_out.append({
            **p,
            "surfaceTreated": surface,
            "surfaceTreatedUnitId": surface_unit_id,
            "standardSurfaceTreated": standard_surface,
        })

    # 2. Volume de bouillie préparé/utilisé : bases saisies par l'utilisateur, standardisées
    total_qty_unit_id, standard_total_quantity = resolve_and_standardize(
        treatment_data.get("treatmentTotalQuantity"), treatment_data.get("treatmentTotalQuantityUnit")
    )
    used_qty_unit_id, standard_total_quantity_used = resolve_and_standardize(
        treatment_data.get("treatmentTotalQuantityUsed"), treatment_data.get("treatmentTotalQuantityUsedUnit")
    )
    standard_total_quantity = standard_total_quantity or 0.0
    standard_total_quantity_used = standard_total_quantity_used or 0.0

    # 3. Dose (par 100L de bouillie) -> quantité de produit, sur le volume utilisé
    composition_out = []
    for c in composition_in:
        dose = c.get("productDose")
        dose_unit_id, standard_dose = resolve_and_standardize(dose, c.get("productDoseUnit"))
        standard_dose = standard_dose or 0.0
        quantity_unit_id = mass_or_volume_unit_id(c.get("productDoseUnit"))
        composition_out.append({
            **c,
            "productDose": dose,
            "productDoseUnitId": dose_unit_id,
            "standardProductDose": standard_dose,
            "productQuantity": standard_dose * standard_total_quantity_used,
            "productQuantityUnitId": quantity_unit_id,
            "standardProductQuantity": standard_dose * standard_total_quantity_used,
        })

    # 4. Quantité de bouillie par parcelle : répartition choisie par l'utilisateur si fournie
    #    (étape "Répartition"), sinon au prorata de sa part de surface traitée par défaut.
    for p in parcels_out:
        sent_quantity = p.get("treatmentQuantity")
        if sent_quantity:
            _, standardized = resolve_and_standardize(sent_quantity, p.get("treatmentQuantityUnit") or "L")
            quantity = standardized if standardized is not None else 0.0
        else:
            share = (p["standardSurfaceTreated"] / total_standard_surface) if total_standard_surface else 0.0
            quantity = share * standard_total_quantity_used
        p["treatmentQuantity"] = quantity
        p["treatmentQuantityUnitId"] = used_qty_unit_id
        p["standardTreatmentQuantity"] = quantity

    treatment_fields = {
        "surfaceTreated": total_standard_surface,
        "standardSurfaceTreated": total_standard_surface,
        "treatmentTotalQuantity": treatment_data.get("treatmentTotalQuantity"),
        "treatmentTotalQuantityUnitId": total_qty_unit_id,
        "standardTreatmentTotalQuantity": standard_total_quantity,
        "treatmentTotalQuantityUsed": treatment_data.get("treatmentTotalQuantityUsed"),
        "treatmentTotalQuantityUsedUnitId": used_qty_unit_id,
        "standardTreatmentTotalQuantityUsed": standard_total_quantity_used,
    }
    return treatment_fields, parcels_out, composition_out
