import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// No real external store to subscribe to — this only exists to get the two
// different snapshots below (server vs. client) without calling setState
// inside an effect, which is what useSyncExternalStore is for.
function subscribe() {
  return () => {};
}

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * Server-rendered output can't know the real color scheme, so it renders 'light' on the server
 * and swaps to the real value once hydrated on the client — avoids a hydration mismatch.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
