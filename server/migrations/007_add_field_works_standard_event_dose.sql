-- Base : c2544857c_appifield
-- standardEventDose manquait sur fieldWorks, contrairement à toutes les tables
-- analogues (parcels.standardParcelArea, phytoTreatments.standardSurfaceTreated,
-- phytoTreatmentsComposition.standardProductDose, inventoriesOperations.standardQuantity),
-- cassant POST/PUT /field_works (colonne référencée par app/routes/field_works.py
-- mais absente de la table).

ALTER TABLE fieldWorks ADD COLUMN standardEventDose DOUBLE AFTER eventDoseUnitId;
