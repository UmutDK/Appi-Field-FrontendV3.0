export interface PhytoProduct {
  product_id: string;
  product_name: string;
  product_numaut: string;
  product_statut: string;
  product_type: string;
  list_sa: string[];
  user_group: string;
  bio: boolean;
  global_max_app: number;
  surf_global_rate_max: string;
  surf_global_rate_max_unit: string;
  vol_global_rate_max: string;
  vol_global_rate_max_unit: string;
  date_act: string;
  date_act_to: string;
  use_tolerated_to: string;
  crop_use: CropUse[];
}

export interface CropUse {
  crop_id: string;
  crop_name: string;
  targets: Target[];
}

export interface Target {
  target_name: string;
  target_rate_min: string;
  target_rate_max: string;
  target_rate_unit: string;
  target_rate_unit_key: string;
  target_rate_unit_type: string;
  target_app_max: string;
  target_app_min: string;
}

export interface PurchaseEntry {
  adding_date: string;
  quantity: number;
  quantity_unit: 'L' | 'Kg';
  expiration_date: string;
}
