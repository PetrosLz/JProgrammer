import { roleColors, type RoleDraft } from "./setupData";

export type BusinessTypePresetId =
  | "cafe"
  | "restaurant"
  | "hotel"
  | "gym"
  | "custom";

export type BusinessTypePreset = {
  id: BusinessTypePresetId;
  label: string;
  businessTypeValue: string;
  roles: Array<{
    name: string;
    color?: string;
    description?: string;
  }>;
};

export const businessTypePresets: BusinessTypePreset[] = [
  {
    id: "cafe",
    label: "Cafe / Cafeteria",
    businessTypeValue: "Cafe / Cafeteria",
    roles: [
      { name: "Barista" },
      { name: "Service" },
      { name: "Cashier" },
      { name: "Kitchen / Preparation" },
      { name: "Supervisor" }
    ]
  },
  {
    id: "restaurant",
    label: "Restaurant",
    businessTypeValue: "Restaurant",
    roles: [
      { name: "A Waiter" },
      { name: "B Waiter" },
      { name: "Metr" },
      { name: "Supervisor" },
      { name: "Chef" },
      { name: "Sous Chef" },
      { name: "Kitchen Assistant" },
      { name: "Delivery" }
    ]
  },
  {
    id: "hotel",
    label: "Small Hotel / Boutique Hotel",
    businessTypeValue: "Small Hotel / Boutique Hotel",
    roles: [
      { name: "Manager" },
      { name: "Receptionist" },
      { name: "Night Auditor" },
      { name: "Head Housekeeper" },
      { name: "Room Attendant" },
      { name: "Cleaner" },
      { name: "Cook" },
      { name: "Buffet Service" },
      { name: "Barista" },
      { name: "Gardener" },
      { name: "Pool Maintenance" },
      { name: "Security" }
    ]
  },
  {
    id: "gym",
    label: "Gym / Fitness Studio",
    businessTypeValue: "Gym / Fitness Studio",
    roles: [
      { name: "Manager" },
      { name: "Reception" },
      { name: "Trainer" },
      { name: "Personal Trainer" },
      { name: "Cleaner" }
    ]
  },
  {
    id: "custom",
    label: "Custom / Start from empty",
    businessTypeValue: "",
    roles: []
  }
];

export function getBusinessTypePresetById(
  presetId: BusinessTypePresetId | string
): BusinessTypePreset {
  return (
    businessTypePresets.find((preset) => preset.id === presetId) ??
    businessTypePresets[businessTypePresets.length - 1]
  );
}

export function getBusinessTypePresetIdForValue(
  businessType: string
): BusinessTypePresetId {
  const normalizedValue = businessType.trim().toLocaleLowerCase();
  const matchedPreset = businessTypePresets.find(
    (preset) =>
      preset.id !== "custom" &&
      preset.businessTypeValue.toLocaleLowerCase() === normalizedValue
  );

  return matchedPreset?.id ?? "custom";
}

export function createRoleDraftsFromBusinessTypePreset(
  preset: BusinessTypePreset
): RoleDraft[] {
  return preset.roles.map((role, index) => ({
    name: role.name,
    color: role.color ?? roleColors[index % roleColors.length],
    description: role.description ?? ""
  }));
}

export function isRoleDraftListEffectivelyEmpty(roles: RoleDraft[]): boolean {
  return roles.every(
    (role) => !role.name.trim() && !role.description.trim()
  );
}
