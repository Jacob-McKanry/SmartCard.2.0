import { useKindeAuth } from '@kinde/expo';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The gate everything else sits behind. Two buttons and nothing more — there
 * is no password field because there is no password here: `login()` opens
 * Kinde in a system browser sheet (`ASWebAuthenticationSession` on iOS), the
 * user authenticates there, and the app is handed back tokens through the
 * `smartcard://` redirect. This app never sees a credential.
 *
 * WHY A FAILURE IS SHOWN RATHER THAN RETRIED
 *
 * `login()` answers `{success: false, errorMessage}` for both a real failure
 * and an ordinary cancellation — the user dismissing the browser sheet is not
 * an error and must not look like one. So a failed result puts the screen back
 * the way it was and shows nothing; only a genuinely surprising message is
 * surfaced, and even then as text rather than an alert, because a modal on top
 * of a dismissed browser sheet is how you get a stuck screen.
 */
export function SignInScreen() {
  const kinde = useKindeAuth();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(action: 'login' | 'register') {
    setBusy(true);
    setProblem(null);
    try {
      const result = action === 'login' ? await kinde.login({}) : await kinde.register({});
      // `isAuthenticated` on the provider flips on success and the gate above
      // swaps this screen out, so there is nothing to do with a success here.
      if (!result.success) {
        setProblem(result.errorMessage || null);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong signing in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">SmartCard</ThemedText>
      <ThemedText style={styles.tagline} themeColor="textSecondary">
        Connections you actually made, in person.
      </ThemedText>

      {busy ? (
        <ActivityIndicator accessibilityLabel="Signing in" />
      ) : (
        <ThemedView style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void run('login')}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">Sign in</ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void run('register')}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">Create an account</ThemedText>
          </Pressable>
        </ThemedView>
      )}

      {problem !== null && (
        <ThemedText type="small" style={styles.problem} themeColor="textSecondary">
          {problem}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  tagline: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  actions: {
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  problem: {
    textAlign: 'center',
  },
});
