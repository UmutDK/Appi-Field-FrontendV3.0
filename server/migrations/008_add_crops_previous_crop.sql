-- Base : c2544857c_appifield
-- previousCrop (précédent cultural) était saisi dans le formulaire de culture mais
-- n'avait jamais de colonne pour être persisté, ni côté DB ni côté API.

ALTER TABLE crops ADD COLUMN previousCrop VARCHAR(255) AFTER sowingDate;
