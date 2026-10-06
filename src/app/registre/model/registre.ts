export class Registre {
    constructor(
        public parcels_id:                    string,
        public parcels:                       string,
        public crops_id:                      string,
        public parcel_surface:                number,
        public parcel_surface_treated:        number, // egale parce surface
        public surface_unit:                  string,
        public standard_surface_treated:      number,//auto
        public treatment_volume_applied:      number,// 0 par defaut
        public treatment_volume_applied_unit: string,// L
    ){}
}
