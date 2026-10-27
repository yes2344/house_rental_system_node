export const PROPERTY_FACILITIES = [
  "Hot Water",
  "Balcony",
  "24-hour Electricity",
  "Dining Area",
  "Air Conditioning",
  "Appliances",
  "Backup Generator",
  "CCTV",
  "Electricity Backup",
  "Elevator / Lift",
  "Emergency Exits",
  "Firefighting Equipment",
  "TV",
  "En Suite Bathroom",
  "Wi-Fi",
  "Wardrobe",
  "Fitted Kitchen",
] as const;

export interface ParsedPropertyFeatures {
  facilities: string[];
  additional: string;
}

export function parsePropertyFeatures(value: string): ParsedPropertyFeatures {
  const facilities: string[] = [];
  const additional: string[] = [];
  const knownFacilities = new Set<string>(PROPERTY_FACILITIES);

  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (knownFacilities.has(trimmed)) facilities.push(trimmed);
    else if (trimmed) additional.push(line);
  }

  return { facilities, additional: additional.join("\n").trim() };
}

export function serializePropertyFeatures(
  facilities: readonly string[],
  additional: string,
): string {
  const selected = PROPERTY_FACILITIES.filter((facility) =>
    facilities.includes(facility),
  );
  const details = additional.trim();
  return [...selected, ...(details ? [details] : [])].join("\n");
}
