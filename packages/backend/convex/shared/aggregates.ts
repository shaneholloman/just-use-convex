export function exactBounds<K>(key: K) {
  return {
    bounds: {
      lower: { key, inclusive: true },
      upper: { key, inclusive: true },
    },
  };
}
