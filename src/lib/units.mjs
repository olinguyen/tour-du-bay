// The unit conversions the app and the scripts that build its data both need, stated once.
// Plain .mjs (rather than .ts) so scripts/*.mjs can import it as well; tsconfig's allowJs lets the app do the same.

export const FT_PER_MI = 5280;
export const KM_PER_MI = 1.609344;
export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;
