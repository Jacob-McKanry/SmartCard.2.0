// Metro (via NativeWind's CSS interop, for the Expo web target) knows how to
// bundle .css imports; tsc doesn't, so these ambient module declarations are
// needed purely to stop `tsc --noEmit` from erroring on `import "./x.css"` /
// `import classes from "./x.module.css"` — they don't affect runtime.
declare module "*.css";

declare module "*.module.css" {
  const classes: { readonly [className: string]: string };
  export default classes;
}
