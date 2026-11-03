-- Base : c2544857c_appifield
-- pacDeclarationFlag : préférence « Je déclare mes parcelles à la PAC » (Réglages > Préférences,
-- section « Encodage des parcelles »). 1 = le champ « Code SIGEC » est affiché dans les
-- formulaires de parcelle et « Archiver et renouveler » est proposé ; 0 = ni l'un ni l'autre.
-- NOT NULL DEFAULT 1 : toutes les lignes existantes valent 1.
-- À appliquer AVANT de déployer le backend qui l'utilise (lecture dans
-- app/utils/user_preferences.py, donc aussi dans GET /phyto_treatments/warnings).

ALTER TABLE userPreferences
    ADD COLUMN pacDeclarationFlag BOOLEAN NOT NULL DEFAULT 1 AFTER bbchWarningFlag;
