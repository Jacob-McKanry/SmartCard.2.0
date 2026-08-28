import { KindeAuthProvider } from '@kinde/expo';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { AuthGate } from '@/components/auth-gate';
import { ConfigErrorScreen } from '@/components/config-error-screen';
import { readConfig } from '@/env';

SplashScreen.preventAutoHideAsync();

/**
 * `scopes` is spelled out rather than left to the SDK's default so the two
 * things this app depends on are visible here instead of implied:
 *
 * - `email` is what puts an email claim on the token. `ensureUser` on the
 *   server needs one to create a brand-new `public.users` row (`users.email`
 *   is NOT NULL), so dropping this scope breaks signup and nothing else —
 *   which means it breaks it silently for everyone except new users.
 * - `offline` is what returns a refresh token. Without it the session dies at
 *   the access token's expiry and the user is bounced back to sign-in mid-use.
 */
const KINDE_SCOPES = 'openid profile email offline';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const config = readConfig();

  if (!config.ok) {
    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <ConfigErrorScreen message={config.message} />
      </ThemeProvider>
    );
  }

  return (
    <KindeAuthProvider
      config={{
        domain: config.config.kindeDomain,
        clientId: config.config.kindeClientId,
        scopes: KINDE_SCOPES,
      }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <AuthGate>
          <AppTabs />
        </AuthGate>
      </ThemeProvider>
    </KindeAuthProvider>
  );
}
