import { describe, expect, it } from 'vitest';
import { knownPlace, meansSP } from './knownPlaces';

describe('meansSP', () => {
  it('reads SP in any form', () => {
    for (const typed of [
      'SP', 'sp', ' Sp ', 'S.P.', 's p', 'SP!', 'SP campus', 'at sp', 'SP’s campus', "SP's library",
      'SP with fireworks', 'Singapore Polytechnic', 'singapore poly', 'SINGAPORE POLYTECHNIC open house',
      'Singapore Polytrechnic', 'singapore polytech', 'singaporepolytechnic', "S'pore Poly", 'SG poly',
    ]) expect(meansSP(typed), typed).toBe(true);
  });

  it('leaves other places, and words that only start with sp, alone', () => {
    for (const typed of [
      'Spain', 'space', 'a spa day', 'spongebob', 'Singapore', 'Singapore Zoo', 'polytechnic',
      'Ngee Ann Polytechnic', 'Temasek Poly', 'Nanyang Polytechnic', 'SPH building', 'wasp nest', '',
    ]) expect(meansSP(typed), typed).toBe(false);
  });
});

describe('knownPlace', () => {
  it('gives the SP campus photo for SP, and nothing for anywhere else', () => {
    expect(knownPlace('Singapore Polytechnic')).toMatchObject({ id: 'sp', src: '/backgrounds/sp-campus.jpg' });
    expect(knownPlace('Marina Bay Sands')).toBeNull();
  });
});
