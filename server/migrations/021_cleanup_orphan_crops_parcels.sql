-- Base : appifield (c2658180c_appifieldTest1 sur le nouveau serveur, ou c2544857c_appifield)
-- Nettoyage de cropsParcels : supprime les liens culture–parcelle qui ne pointent vers aucune
-- parcelle existante (parcelle supprimée avant que DELETE /parcels ne le refuse, cf.
-- updateToDo/12_parcelsDelete.md), ou dont parcelId est NULL / vide.
-- Ne touche QUE cropsParcels : traitements phyto (phytoTreatmentsParcelsCrops) et travaux aux
-- champs (fieldWorksParcelsCrops) ne sont pas modifiés, ni les cultures elles-mêmes (crops).
-- Les lignes supprimées sont d'abord copiées dans cropsParcelsBackup021 (annulation possible,
-- voir en bas). Ré-exécutable : la 2e fois, plus rien ne correspond.
-- Sur c2544857c_appifield au 12/11/2026 : 25 lignes concernées sur 2709 (0 NULL/vide).

-- 1. (facultatif) Aperçu : lignes qui vont être supprimées
SELECT cp.*
  FROM cropsParcels cp
 WHERE cp.parcelId IS NULL
    OR TRIM(cp.parcelId) = ''
    OR NOT EXISTS (SELECT 1 FROM parcels p WHERE p.parcelId = cp.parcelId);

-- 2. Sauvegarde des lignes concernées
CREATE TABLE IF NOT EXISTS cropsParcelsBackup021 LIKE cropsParcels;

INSERT IGNORE INTO cropsParcelsBackup021
SELECT cp.*
  FROM cropsParcels cp
 WHERE cp.parcelId IS NULL
    OR TRIM(cp.parcelId) = ''
    OR NOT EXISTS (SELECT 1 FROM parcels p WHERE p.parcelId = cp.parcelId);

-- 3. Suppression
DELETE cp
  FROM cropsParcels cp
 WHERE cp.parcelId IS NULL
    OR TRIM(cp.parcelId) = ''
    OR NOT EXISTS (SELECT 1 FROM parcels p WHERE p.parcelId = cp.parcelId);

-- Annulation (si besoin) :
--   INSERT IGNORE INTO cropsParcels SELECT * FROM cropsParcelsBackup021;
-- Une fois vérifié, la sauvegarde peut être supprimée :
--   DROP TABLE cropsParcelsBackup021;
