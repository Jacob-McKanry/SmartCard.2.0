import { useKindeAuth } from '@kinde/expo';
import { type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { SignInScreen } from '@/components/sign-in-screen';
import { ThemedView } from '@/components/themed-view';

/**
 * Renders the app only for a signed-in caller, and the sign-in screen
 * otherwise.
 *
 * WHY THE LOADING STATE IS ITS OWN BRANCH
 *
 * `isAuthenticated` is `false` before the provider has finished reading
 * `expo-secure-store`, which is indistinguishable from "signed out" if you
 * only check that one flag. Treating the two the same would flash the sign-in
 * screen at somebody who is already signed in, every cold start — and worse,
 * invite them to sign in again while a perfectly good session was still
 * loading. `isLoading` is checked first for that reason.
 *
 * This is a conditional render rather than an expo-router route group on
 * purpose. There is exactly one screen behind the gate today, so a redirect
 * between route groups would be machinery without a job. When the real tab
 * structure lands, this becomes a route group and the reasoning above moves
 * with it.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useKindeAuth();

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </ThemedView>
    );
  }

  return isAuthenticated ? <>{children}</> : <SignInScreen />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
