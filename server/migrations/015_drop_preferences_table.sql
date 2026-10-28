-- Base : c2544857c_appifield
-- Suppression de l'ancienne table `preferences` (migration 003 : type de pulvérisateur, mode
-- d'encodage, cultures suivies), remplacée par `userPreferences` (migration 014). Vide en
-- production au 27/10/2026 (0 ligne) : aucune donnée perdue. La route /preferences est
-- retirée du backend en même temps ; le frontend doit retirer la page « mes-preferences »
-- qui l'appelait (voir updateToDo/06_removeMesPreferences.md).
-- À appliquer APRÈS la migration 014 (qui lisait encore cette table pour initialiser
-- userPreferences dans une version antérieure).

DROP TABLE IF EXISTS preferences;
