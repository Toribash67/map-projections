import { feature } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';
import { displayName } from './displayNames';

/** A country to be named: its name as it is lettered, and its shape. */
export type CountryShape = { name: string; geometry: GeoJSON.Geometry };

const topology = countriesTopology as any;

/**
 * Every country at 1:110m, each a shape of its own, for fitting its name to. The political colours have them merged by colour, which
 * is of no use here. Each is one object for the whole session, as the cut keeps what it prepares by object. The coarse shapes serve at
 * every scale: a name is fitted to the lie of its country, which a finer coast does not change.
 */
export const COUNTRY_SHAPES: CountryShape[] = (feature(topology, topology.objects.countries) as unknown as GeoJSON.FeatureCollection).features
  .filter((country) => country.geometry && typeof country.properties?.name === 'string')
  .map((country) => ({ name: displayName(country.properties!.name as string), geometry: country.geometry }));
