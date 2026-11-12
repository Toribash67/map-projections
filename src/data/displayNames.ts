/**
 * The names that are lettered where they are not Natural Earth's own, which are cut short to fit a table: a short form spelled out,
 * and a long name in the form an atlas letters it. A country that is not here is lettered as Natural Earth names it.
 */
const DISPLAY: Record<string, string> = {
  'Bosnia and Herz.': 'Bosnia & Herzegovina',
  'Central African Rep.': 'Central African Republic',
  'Dem. Rep. Congo': 'DR Congo',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern Lands',
  'N. Cyprus': 'Northern Cyprus',
  'S. Sudan': 'South Sudan',
  'Solomon Is.': 'Solomon Islands',
  'W. Sahara': 'Western Sahara',
  'United States of America': 'United States',
  Macedonia: 'North Macedonia',
  eSwatini: 'Eswatini',
};

/** A country's name as it is lettered. */
export const displayName = (name: string): string => DISPLAY[name] ?? name;
