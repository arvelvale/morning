/** Local grip points are tied to the named builder geometry, not its bounding-box centre. */
export interface Grip { point: [number, number, number]; upright?: boolean }
export const PROP_GRIPS: Record<string, Grip> = {
  phone: { point: [0, 0, 0] },
  umbrella: { point: [0, 0, 0], upright: true },
  book: { point: [0, .016, 0] },
  teacup: { point: [.07, .05, .035], upright: true },
  backpack: { point: [0, .46, 0], upright: true },
  luggage: { point: [0, .88, 0], upright: true },
  photoFrame: { point: [0, 0, 0] },
};
