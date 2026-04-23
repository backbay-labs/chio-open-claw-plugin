import {
  listSubscriptionsForAgent,
  putSubscription,
  removeSubscriptionsForAgent,
} from "../storage.js";

export interface Subscription {
  surface: "slack" | "discord" | "telegram";
  channelId: string;
  threadId: string;
  agent: string;
}

export function subscribe(s: Subscription): void {
  putSubscription(s);
}

export function subscribersFor(agent: string): Subscription[] {
  return listSubscriptionsForAgent(agent).map((r) => ({
    surface: r.surface as Subscription["surface"],
    channelId: r.channelId,
    threadId: r.threadId,
    agent: r.agent,
  }));
}

export function unsubscribeAgent(agent: string): void {
  removeSubscriptionsForAgent(agent);
}
