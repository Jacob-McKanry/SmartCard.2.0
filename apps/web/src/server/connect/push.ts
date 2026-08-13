import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { expoAccessToken } from "@/server/env";
import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * Sending push notifications through Expo's push service (§7.5, Q24).
 *
 * WHAT THIS IS FOR, AND WHY IT IS A SECURITY CONTROL RATHER THAN A FEATURE
 * Q17 decided a card tap connects instantly, with no confirmation step by the
 * card owner, because requiring one breaks the only thing a physical card is
 * good at. That removes the last preventive control on the NFC path, so the
 * design leans on a detective one: the owner is told the instant a tap commits,
 * with revoke-card one tap away. §4.7 threat 7 is explicit that the property
 * which changed is DETECTION LATENCY — from weeks (noticing an unfamiliar name
 * in a connection list) to seconds. This module is that control.
 *
 * THE ONE PLACE IN THE CONNECT PATH THAT DELIBERATELY DOES NOT FAIL CLOSED
 * §0 and CLAUDE.md both say connection logic fails closed. Notification
 * delivery is the stated exception (§4.5 amendment): a failed or delayed push
 * must never block, delay, or reverse the connection. Physical possession of
 * the card is the proof and it is already complete by the time we get here;
 * refusing a connection because a push vendor was having an outage would break
 * the product for a reason unrelated to whether the meeting happened. So
 * EVERY function below resolves rather than throws, and the caller does not
 * await its result in a way that can fail the request.
 *
 * WHAT MUST NOT HAPPEN INSTEAD IS SILENT BREAKAGE. §4.5 is equally explicit
 * that a notification pipeline dead for a week is a security regression even
 * though no single connection was affected. So every failure path here logs
 * loudly, including the "no token configured" one, which is the state this
 * project is in right now.
 *
 * PAYLOAD CONTENT IS CONSTRAINED, AND THE CONSTRAINT IS NOT ABOUT TASTE
 * §7.5: notification content transits a third party (Expo) and renders on a
 * lock screen where anyone holding the phone reads it without unlocking.
 * §4.5's amendment sets the ceiling at the tapper's display name and the time.
 * NO LOCATION, EVER — card taps have no GPS gate so there is nothing to send
 * today, and the rule is written here so that a later "helpful" addition
 * pulling a coarse position from the tapping device is recognised as the change
 * it would be. Also no tokens, no session ids, and nothing from
 * `meeting_locations`.
 *
 * TODAY THERE ARE ZERO REGISTERED TOKENS FOR ANYBODY, and that is expected:
 * mobile Kinde auth and token registration are not built (they need the EAS dev
 * build, §7.2). The mechanism is real and correct so that it works the day the
 * first token is registered, and so that the absence of one is visible in the
 * logs rather than looking like success.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface PushToken {
  id: string;
  expo_push_token: string;
}

export interface CardTapNotification {
  /** The card's owner — the person being told. */
  ownerUserId: string;
  /** The card that was tapped, used as the coalescing subject. */
  cardId: string;
  /** The tapper's display name. The ceiling of what may be in the payload. */
  tapperDisplayName: string;
  /** The connection the notification deep-links to, for revoke / remove. */
  connectionId: string;
  /** How many OTHER taps of this card fell inside the coalescing window. */
  otherTapCount: number;
}

/**
 * Builds the notification body.
 *
 * Coalescing (§4.5 amendment): a card left on a table at a conference can be
 * tapped repeatedly, and thirty pushes in a minute trains the owner to ignore
 * the alert that matters — which would destroy the very control this exists to
 * provide. One notification, with a rolled-up count.
 */
export function cardTapNotificationBody(input: {
  tapperDisplayName: string;
  otherTapCount: number;
}): string {
  if (input.otherTapCount <= 0) {
    return `${input.tapperDisplayName} just tapped your card.`;
  }
  if (input.otherTapCount === 1) {
    return `${input.tapperDisplayName} and 1 other just tapped your card.`;
  }
  return `${input.tapperDisplayName} and ${input.otherTapCount} others just tapped your card.`;
}

/**
 * Loads a user's live tokens. `disabled_at is null` filters out tokens Expo has
 * already told us are dead — without that, the send path slowly becomes mostly
 * failures and real failures stop being visible (§4.5's operational rule).
 */
async function liveTokensFor(client: SupabaseClient, userId: string): Promise<PushToken[]> {
  const { data, error } = await client
    .from("user_push_tokens")
    .select("id, expo_push_token")
    .eq("user_id", userId)
    .is("disabled_at", null);

  if (error) {
    console.error("[push] failed to load push tokens", { userId, message: error.message });
    return [];
  }
  return (data ?? []) as PushToken[];
}

/**
 * Marks a token dead. Expo returns `DeviceNotRegistered` when the app was
 * uninstalled or the token rotated; retrying such a token forever is how a
 * notification pipeline silently rots.
 */
async function disableToken(client: SupabaseClient, tokenId: string): Promise<void> {
  const { error } = await client
    .from("user_push_tokens")
    .update({ disabled_at: new Date().toISOString() })
    .eq("id", tokenId);

  if (error) {
    console.error("[push] failed to disable dead token", { tokenId, message: error.message });
  }
}

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Sends one notification to every live device a user has registered.
 *
 * Returns a small report rather than throwing, always. The caller logs it; no
 * branch of it can fail a connection.
 */
export async function sendCardTapNotification(
  notification: CardTapNotification,
  client: SupabaseClient = serviceRoleClient(),
): Promise<{ attempted: number; delivered: number; skippedReason?: string }> {
  try {
    const tokens = await liveTokensFor(client, notification.ownerUserId);
    if (tokens.length === 0) {
      // Expected today — nobody has registered a device yet. Logged rather than
      // returned silently, because "nobody is registered" and "sending is
      // broken" look identical from the outside and only one of them is fine.
      console.info("[push] no live push tokens for card owner; nothing sent", {
        ownerUserId: notification.ownerUserId,
      });
      return { attempted: 0, delivered: 0, skippedReason: "no_registered_tokens" };
    }

    const accessToken = expoAccessToken();
    if (accessToken === null) {
      console.warn("[push] EXPO_ACCESS_TOKEN is not set; card-tap notification not sent", {
        ownerUserId: notification.ownerUserId,
        tokens: tokens.length,
      });
      return { attempted: 0, delivered: 0, skippedReason: "no_expo_credential" };
    }

    const body = cardTapNotificationBody(notification);

    const messages = tokens.map((token) => ({
      to: token.expo_push_token,
      title: "Someone tapped your card",
      body,
      // The deep link target. `data` is delivered to the app, not rendered on
      // the lock screen — but it still transits Expo, so it carries an id the
      // app resolves behind its own auth, never any content.
      data: { type: "card_tap", connectionId: notification.connectionId },
      // High priority: the entire value of this notification is remediation
      // speed. An alert about a possibly-stolen card that arrives with the next
      // batch has lost most of its point.
      priority: "high" as const,
    }));

    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(messages),
      // Bounded, so a hanging vendor cannot hold a request open. The connection
      // is already committed by this point; there is nothing to wait for.
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error("[push] Expo push API returned an error status", {
        status: response.status,
        ownerUserId: notification.ownerUserId,
      });
      return { attempted: messages.length, delivered: 0, skippedReason: "expo_http_error" };
    }

    const payload = (await response.json()) as { data?: ExpoTicket[] };
    const tickets = payload.data ?? [];

    let delivered = 0;
    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i];
      const token = tokens[i];
      if (ticket === undefined || token === undefined) continue;

      if (ticket.status === "ok") {
        delivered += 1;
        continue;
      }
      if (ticket.details?.error === "DeviceNotRegistered") {
        await disableToken(client, token.id);
        continue;
      }
      console.error("[push] Expo rejected a message", {
        ownerUserId: notification.ownerUserId,
        error: ticket.details?.error ?? ticket.message,
      });
    }

    return { attempted: messages.length, delivered };
  } catch (error) {
    // The catch-all that makes the "never fails the connection" promise true.
    // Network error, timeout, malformed JSON from the vendor — all land here,
    // all get logged, none propagate.
    console.error("[push] card-tap notification failed", {
      ownerUserId: notification.ownerUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { attempted: 0, delivered: 0, skippedReason: "exception" };
  }
}
