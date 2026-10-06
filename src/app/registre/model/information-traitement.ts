import { Registre } from "./registre";
import { TreatmentComposition } from "./treatment-composition";

export class InformationTraitement {
        event_hour?:                     string;
        event_bbch_stage?:               string;

    constructor(
        public event_id:                       string,
        public type:                           string,
        public event_date:                     string,
        public parcels_concerned:              Registre[],
        public standard_total_surface_treated: number,
        public treatment_composition:          TreatmentComposition[],
        public treatment_total_dose_inital:    number,
        public treatment_total_dose_used:      number,
        public  treatment_total_dose_used_unit: string,
    ){}
}
