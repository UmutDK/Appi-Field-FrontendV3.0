-- Base : c2544857c_appifield
-- bbch : stade phénologique saisi par l'utilisateur dans le formulaire de traitement
-- (champ « Mentionnez un stade phénologique », ex. « BBCH 31 »). Le champ existait côté
-- frontend mais n'avait jamais de colonne : la valeur était perdue à chaque enregistrement.
-- Repris dans la colonne « Stade phénologique » de l'export du registre.
-- Texte libre, NULL si vide. Tous les traitements existants : NULL.
-- À appliquer AVANT de déployer le backend qui l'utilise (INSERT/UPDATE dans
-- app/routes/phyto_treatments.py, SELECT dans app/utils/exports.py).

ALTER TABLE phytoTreatments
    ADD COLUMN bbch VARCHAR(255) NULL DEFAULT NULL AFTER treatmentType;
