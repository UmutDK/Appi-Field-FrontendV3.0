-- Base : c2544857c_appifield
-- phytoTreatmentsParcelsCrops n'avait pas de colonne dédiée à la surface traitée par
-- parcelle : le frontend détournait treatmentQuantity (censée être une quantité de
-- produit) pour y stocker une surface (voir registre.service.ts::treatmentParcelToApi).
-- De même, phytoTreatments n'avait pas d'unité/standardisation pour ses totaux
-- (treatmentTotalQuantity/treatmentTotalQuantityUsed), empêchant de les traiter comme
-- les autres triplets valeur/unitId/standardValeur du schéma.
-- Ajouté pour le nouveau moteur de calcul par mode (Surface/Bouillie/Quantité),
-- voir server/app/utils/treatment_calc/.

ALTER TABLE phytoTreatmentsParcelsCrops
  ADD COLUMN surfaceTreated DOUBLE AFTER standardTreatmentQuantity,
  ADD COLUMN surfaceTreatedUnitId TEXT AFTER surfaceTreated,
  ADD COLUMN standardSurfaceTreated DOUBLE AFTER surfaceTreatedUnitId;

ALTER TABLE phytoTreatments
  ADD COLUMN treatmentTotalQuantityUnitId TEXT AFTER treatmentTotalQuantity,
  ADD COLUMN treatmentTotalQuantityUsedUnitId TEXT AFTER treatmentTotalQuantityUsed,
  ADD COLUMN standardTreatmentTotalQuantity DOUBLE AFTER treatmentTotalQuantityUnitId,
  ADD COLUMN standardTreatmentTotalQuantityUsed DOUBLE AFTER treatmentTotalQuantityUsedUnitId;
