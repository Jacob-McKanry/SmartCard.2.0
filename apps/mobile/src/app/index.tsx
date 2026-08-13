import { View, Text } from "react-native";

import { placeholder as apiClientPlaceholder } from "@smartcard/api-client";

export default function HomeScreen() {
  // Proves the pnpm workspace wiring (apps/mobile -> packages/api-client ->
  // packages/types) actually resolves at build time.
  //
  // `@smartcard/core`'s matching placeholder was removed when that package
  // gained its real contents — the connection-verification layer (§4). Mobile
  // does not import it yet: §4's verifiers are server-side by construction
  // (they hold the QR signing secret and reach the database through a port),
  // and the phone talks to our API rather than running them (§7.4). What mobile
  // will import from `@smartcard/core` is the pure part — the distance
  // calculation and the shared types — once there is a screen that needs them.
  console.log(apiClientPlaceholder());

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-black">
      <Text className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        SmartCard — under construction
      </Text>
    </View>
  );
}
