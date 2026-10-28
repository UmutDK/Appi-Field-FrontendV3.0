-- Base : c2544857c_appifield
-- treatmentType : méthode d'application du traitement (à ne pas confondre avec eventType,
-- qui est le mode d'encodage Surface/Bouillie/Quantité). Valeurs autorisées (validées par
-- l'API, voir TREATMENT_TYPES dans app/routes/phyto_treatments.py) :
--   pulvérisation, traitement de semences, microgranulé, arrosage, irrigation,
--   badigeonnage, injection, trempage
-- NOT NULL DEFAULT 'pulvérisation' : tous les traitements déjà encodés prennent cette valeur.
-- À appliquer AVANT de déployer le backend qui l'utilise.

ALTER TABLE phytoTreatments
    ADD COLUMN treatmentType VARCHAR(50) NOT NULL DEFAULT 'pulvérisation' AFTER thirdPartFlag;
