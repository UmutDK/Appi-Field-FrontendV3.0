export class TreatmentComposition {
    constructor(
        public component_id:            string,
        public component_name:          string,
        public component_numaut:        string,
        public component_type:          string,
        public component_dose:          number,
        public component_dose_unit:     string,
        public component_dose_unit_fr:  string,
        public standard_component_dose: number,
    ){}
}
