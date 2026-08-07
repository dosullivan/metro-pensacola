import { describe, expect, it } from 'vitest';
import { PENSACOLA_DATA_METADATA, PENSACOLA_ZONES } from '../src/data/pensacola/zones';

describe('Pensacola ACS/LODES zone data', () => {
  it('uses generated real block-group zones with ACS and LODES metadata', () => {
    expect(PENSACOLA_DATA_METADATA.acsYear).toBe(2024);
    expect(PENSACOLA_DATA_METADATA.lodesYear).toBe(2023);
    expect(PENSACOLA_DATA_METADATA.bbox).toBeNull();
    expect(PENSACOLA_DATA_METADATA.zoneCount).toBe(PENSACOLA_ZONES.length);
    expect(PENSACOLA_ZONES.length).toBeGreaterThan(250);
    expect(new Set(PENSACOLA_ZONES.map((zone) => zone.countyName))).toEqual(
      new Set(['Escambia County', 'Santa Rosa County'])
    );
    expect(PENSACOLA_ZONES.every((zone) => /^\d{12}$/.test(zone.id))).toBe(true);
    expect(PENSACOLA_ZONES.reduce((sum, zone) => sum + zone.population, 0)).toBe(
      PENSACOLA_DATA_METADATA.totalPopulation
    );
    expect(PENSACOLA_ZONES.reduce((sum, zone) => sum + zone.jobs, 0)).toBe(
      PENSACOLA_DATA_METADATA.totalJobs
    );
  });
});
