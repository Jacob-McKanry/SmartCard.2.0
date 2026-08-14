/**
 * `public.cities` — see 20260814051000_table_cities_and_event_capacity_columns.sql
 *
 * A curated, admin-managed list of the cities an event can be held in, not a
 * free-text field and not a geocoded place. Free text produces "NYC", "New
 * York" and "new york city" as three different cities within a week, which
 * breaks the one query browse exists to answer.
 *
 * There is no `CityInsert`/`CityUpdate` schema in this file, and that absence
 * is the point: `authenticated` holds SELECT and nothing else on this table
 * (20260814051100), so there is no client-side write for a schema to describe.
 * Editing the list is a service-role operation.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

export const cityRowSchema = z.object({
  id: uuidSchema,

  /** URL-safe stable identifier, e.g. `new-york`. Unique; used in browse URLs. */
  slug: z.string(),

  name: z.string(),

  /** Nullable — "state" is a US concept and a future city may not have one. */
  state: z.string().nullable(),

  /**
   * `false` hides the city from pickers and browse without deleting it. Events
   * reference `cities` with ON DELETE RESTRICT, so deactivating is the only
   * way to retire a city that has history — deleting one is refused by the
   * database.
   */
  is_active: z.boolean(),

  created_at: timestamptzSchema,
});

export type CityRow = z.infer<typeof cityRowSchema>;
