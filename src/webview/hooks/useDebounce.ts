import { useEffect, useState } from "react";

/**
 * Generic debounce hook.
 * Returns a debounced version of the provided value that only updates
 * after the specified delay has elapsed without changes.
 *
 * Usage:
 *   const debouncedSearch = useDebounce(search, 300);
 */
export default function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}
