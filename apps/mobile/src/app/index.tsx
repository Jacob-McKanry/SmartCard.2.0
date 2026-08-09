import { View, Text } from "react-native";

import { placeholder as corePlaceholder } from "@smartcard/core";
import { placeholder as apiClientPlaceholder } from "@smartcard/api-client";

export default function HomeScreen() {
  // Proves the pnpm workspace wiring (apps/mobile -> packages/core,
  // packages/api-client -> packages/types) actually resolves at build time.
  console.log(corePlaceholder(), apiClientPlaceholder());

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-black">
      <Text className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        SmartCard — under construction
      </Text>
    </View>
  );
}
