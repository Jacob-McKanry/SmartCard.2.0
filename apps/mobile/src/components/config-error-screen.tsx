import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * Shown instead of the app when an `EXPO_PUBLIC_*` variable is missing or
 * unsafe. `readConfig()`'s messages already name the variable and where to get
 * its value, so this renders the message verbatim rather than paraphrasing it
 * into something less useful.
 *
 * Deliberately not a crash: a build with a bad variable is a configuration
 * mistake, and the person who has to fix it is holding the phone.
 */
export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">SmartCard isn&apos;t configured</ThemedText>
      <ThemedText style={styles.message} themeColor="textSecondary">
        {message}
      </ThemedText>
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
  message: {
    textAlign: 'center',
  },
});
