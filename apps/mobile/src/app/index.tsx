import { useKindeAuth } from '@kinde/expo';
import { getProfile } from '@smartcard/api-client';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/env';
import { useTheme } from '@/hooks/use-theme';
import { buildApiOptions } from '@/lib/api';

/**
 * The smallest screen that proves the whole chain works on real hardware:
 * Kinde PKCE sign-in -> token in `expo-secure-store` -> `Authorization:
 * Bearer` over HTTP -> `getApiAuthenticatedContext` -> `ensureUser` ->
 * a Supabase token minted server-side -> an RLS-bound read -> back here.
 *
 * It calls `getProfile` rather than `/api/v1/me` deliberately. `me` only
 * echoes ids the server already derived from the token, so it would pass even
 * if the Supabase half of the bridge were broken; a profile read has to
 * survive `mintSupabaseAccessToken` and an actual RLS-scoped query, which is
 * the part most likely to be misconfigured on a first run.
 *
 * This is scaffolding for Phase 2's verification step, not a real home screen.
 */
type State =
  | { status: 'loading' }
  | { status: 'ready'; name: string; email: string | null }
  | { status: 'failed'; message: string };

export default function HomeScreen() {
  const kinde = useKindeAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: 'loading' });

  // Bumped by "Try again" to re-run the effect below. A counter rather than
  // an async function the button calls directly, so there is exactly one place
  // that performs this read and exactly one place that can cancel it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // The read outlives the screen if the user signs out or navigates while it
    // is in flight; without this guard its `setState` lands on an unmounted
    // component, and on a failure it would overwrite a sign-out with an error
    // message about a session that no longer exists.
    let cancelled = false;

    void (async () => {
      try {
        const options = buildApiOptions(apiUrl(), kinde);
        const { profile } = await getProfile(options);
        if (cancelled) return;
        const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
        setState({
          status: 'ready',
          name: name === '' ? 'your account' : name,
          email: profile.email ?? null,
        });
      } catch (error) {
        if (cancelled) return;
        // Shown verbatim: everything reaching here is either an ApiV1Error,
        // whose message the server wrote for a human, or a configuration error
        // that names the variable at fault. Paraphrasing either into
        // "something went wrong" would throw away the only useful thing on
        // the screen.
        setState({
          status: 'failed',
          message: error instanceof Error ? error.message : 'Something went wrong.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kinde, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.six }]}>
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle">Signed in</ThemedText>

        {state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading profile" />}

        {state.status === 'ready' && (
          <>
            <ThemedText>{state.name}</ThemedText>
            {state.email !== null && (
              <ThemedText type="small" themeColor="textSecondary">
                {state.email}
              </ThemedText>
            )}
          </>
        )}

        {state.status === 'failed' && (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {state.message}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={retry}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">Try again</ThemedText>
            </Pressable>
          </>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => void kinde.logout({ revokeToken: true })}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">Sign out</ThemedText>
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.three,
  },
  centered: {
    textAlign: 'center',
  },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.7,
  },
});
