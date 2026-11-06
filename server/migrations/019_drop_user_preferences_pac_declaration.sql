-- Base : c2544857c_appifield
-- Suppression de la préférence « Je déclare mes parcelles à la PAC » (migration 017) :
-- le champ « Code SIGEC » est de nouveau toujours affiché et « Archiver et renouveler »
-- toujours proposé.
-- ⚠️ À appliquer APRÈS avoir déployé le backend qui ne lit plus cette colonne
-- (app/utils/user_preferences.py) : l'ancien backend la lit à chaque GET /user_preferences
-- et GET /phyto_treatments/warnings, qui échoueraient si elle disparaissait avant.

ALTER TABLE userPreferences DROP COLUMN pacDeclarationFlag;
