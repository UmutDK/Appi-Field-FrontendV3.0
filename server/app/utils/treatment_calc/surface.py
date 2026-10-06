"""
Mode Surface : l'utilisateur fixe la surface traitée par parcelle (défaut = surface de
la parcelle) et la dose de chaque produit (par ha/are/m²). Tout le reste (quantités,
totaux) est dérivé.
"""
from app.utils.units import resolve_and_standardize
from .common import resolve_surface, mass_or_volume_unit_id, sum_standardized_by_unit


def compute(cur, user_id, treatment_data, parcels_in, composition_in):
    # 1-2. Surface par parcelle, puis surface totale du traitement
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

    # 3. Dose -> quantité par produit (sur la surface totale du traitement)
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
            "productQuantity": standard_dose * total_standard_surface,
            "productQuantityUnitId": quantity_unit_id,
            "standardProductQuantity": standard_dose * total_standard_surface,
        })

    # 4. Quantité de produit par parcelle = somme(dose_standard * surface_standard_de_cette_parcelle)
    for p in parcels_out:
        contributions = [
            {"v": c["standardProductDose"] * p["standardSurfaceTreated"], "u": c["productQuantityUnitId"]}
            for c in composition_out
        ]
        total, unit_id = sum_standardized_by_unit(contributions, "v", "u")
        p["treatmentQuantity"] = total
        p["treatmentQuantityUnitId"] = unit_id
        p["standardTreatmentQuantity"] = total

    # 5. Totaux du traitement = somme des quantités de produit (regroupées par unité kg/l)
    total_quantity, total_unit_id = sum_standardized_by_unit(
        composition_out, "productQuantity", "productQuantityUnitId"
    )

    treatment_fields = {
        "surfaceTreated": total_standard_surface,
        "standardSurfaceTreated": total_standard_surface,
        "treatmentTotalQuantity": total_quantity,
        "treatmentTotalQuantityUnitId": total_unit_id,
        "standardTreatmentTotalQuantity": total_quantity,
        "treatmentTotalQuantityUsed": total_quantity,
        "treatmentTotalQuantityUsedUnitId": total_unit_id,
        "standardTreatmentTotalQuantityUsed": total_quantity,
    }
    return treatment_fields, parcels_out, composition_out
