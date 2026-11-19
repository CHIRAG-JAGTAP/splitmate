export const CATEGORIES = ['food', 'travel', 'accommodation', 'shopping', 'entertainment', 'transport', 'utilities', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const GROUP_TYPES = ['friends', 'trips', 'flatmates', 'family', 'office', 'custom'] as const;
