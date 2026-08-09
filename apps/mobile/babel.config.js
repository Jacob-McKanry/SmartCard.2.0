// NativeWind needs its own babel plugin on top of the standard Expo preset —
// it's what turns `className="..."` into React Native styles at build time.
// See https://www.nativewind.dev/getting-started/installation
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
