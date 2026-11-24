import { describe, expect, it } from 'vitest';
import { cloudSafeAttribute } from './attribute';

const ok = (cat: string, value: string) => cloudSafeAttribute({ cat: cat as never, value });

describe('cloudSafeAttribute: only generic attributes leave the device', () => {
  it('allows a generic job, family role or pet', () => {
    expect(ok('occupation', 'registered nurse')).toEqual({ ok: true, attribute: 'occupation: registered nurse' });
    expect(ok('family', 'parent of twins')).toEqual({ ok: true, attribute: 'family: parent of twins' });
    expect(ok('occupation', 'ICU nurse')).toEqual({ ok: true, attribute: 'occupation: icu nurse' });
  });
  it('strips possessive pronouns', () => {
    expect(ok('pet', 'my one-eyed cat')).toEqual({ ok: true, attribute: 'pet: one-eyed cat' });
  });
  it('keeps names, numbers and long phrases local', () => {
    expect(ok('employer_type', "St. Luke's Boise").ok).toBe(false);
    expect(ok('employer_type', 'Mercy hospital').ok).toBe(false);
    expect(ok('vehicle', '2014 subaru outback').ok).toBe(false);
    expect(ok('rare_hobby', 'restoring old wooden sailboats on weekends').ok).toBe(false);
  });
  it('never sends places, health or dated events', () => {
    expect(ok('home_location', 'columbus').ok).toBe(false);
    expect(ok('health', 'asthma').ok).toBe(false);
    expect(ok('dated_event', 'moved in march').ok).toBe(false);
  });
});
