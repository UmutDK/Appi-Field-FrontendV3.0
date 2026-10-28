-- Base : c2544857c_appifield
-- userPreferences : préférences d'encodage des traitements phyto, une ligne par utilisateur.
--   erRiWarningFlag      : 1 = l'utilisateur respecte la campagne Eco-régime réduction d'intrants
--                          -> avertir s'il choisit un produit general.erRiFlag = 1 (défaut 0)
--   spe8HourWarningFlag  : 1 = afficher les avertissements horaires (general.spe8FlagHoraire) (défaut 1)
--   bbchWarningFlag      : 1 = afficher les avertissements BBCH (crops.bbchFlag) (défaut 1)
--   defaultTreatmentType : mode d'encodage présélectionné : 'surface' | 'porridge' | 'quantity'
--                          (= eventType phyto_surface_treatment / phyto_porridge_treatment /
--                          phyto_quantity_treatment) (défaut 'surface')
-- Remplace l'ancienne table `preferences` (migration 003, jamais alimentée), supprimée par
-- la migration 015.
-- Un utilisateur sans ligne se voit appliquer les valeurs par défaut par l'API
-- (GET /user_preferences) ; la ligne est créée à son premier PUT.

CREATE TABLE IF NOT EXISTS userPreferences (
    idUser VARCHAR(255) NOT NULL PRIMARY KEY,
    erRiWarningFlag BOOLEAN NOT NULL DEFAULT 0,
    spe8HourWarningFlag BOOLEAN NOT NULL DEFAULT 1,
    bbchWarningFlag BOOLEAN NOT NULL DEFAULT 1,
    defaultTreatmentType VARCHAR(20) NOT NULL DEFAULT 'surface',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Initialisation pour tous les utilisateurs existants. Les comptes vivent dans le service
-- externe UserKey : on reprend donc tous les userId présents dans les tables de données
-- applicatives (594 utilisateurs distincts au 27/10/2026). INSERT IGNORE : rejouable sans
-- doublon ni écrasement des préférences déjà saisies.
INSERT IGNORE INTO userPreferences (idUser)
SELECT userId FROM (
    SELECT userId FROM exploitations
    UNION SELECT userId FROM parcels
    UNION SELECT userId FROM crops
    UNION SELECT userId FROM cropsParcels
    UNION SELECT userId FROM operators
    UNION SELECT userId FROM phytoTreatments
    UNION SELECT userId FROM fieldWorks
    UNION SELECT userId FROM inventoriesOperations
    UNION SELECT userId FROM personalProducts
    UNION SELECT userId FROM userProfile
    UNION SELECT userId FROM admins
) AS u
WHERE userId IS NOT NULL AND userId <> '';
