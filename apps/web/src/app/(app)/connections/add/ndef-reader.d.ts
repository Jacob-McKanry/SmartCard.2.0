/**
 * Minimal ambient types for the Web NFC API's `NDEFReader`.
 *
 * Not in TypeScript's bundled `lib.dom.d.ts` as of the version pinned in this
 * repo. Implemented, at time of writing, only in Chrome for Android over
 * HTTPS with an explicit user gesture — declared here, scoped to exactly the
 * surface `nfc-tap.tsx` uses, rather than reaching for `any` at the call
 * site. See that file for the feature-detection (`"NDEFReader" in window`)
 * every use of this type is guarded behind.
 */

interface NDEFRecord {
  readonly recordType: string;
  readonly mediaType?: string;
  readonly data?: DataView;
}

interface NDEFMessage {
  readonly records: readonly NDEFRecord[];
}

interface NDEFReadingEvent extends Event {
  readonly message: NDEFMessage;
}

declare class NDEFReader extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  addEventListener(
    type: "reading",
    listener: (event: NDEFReadingEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: "readingerror",
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}
