import { nanoid } from "nanoid";
import type { ActivityEvent } from "../models.js";

type Listener = (event: ActivityEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  private activity: ActivityEvent[] = [];

  emit(type: string, message: string, payload?: unknown): ActivityEvent {
    const event: ActivityEvent = { id: nanoid(), type, message, at: new Date().toISOString(), payload };
    this.activity = [event, ...this.activity].slice(0, 250);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listActivity(): ActivityEvent[] {
    return this.activity;
  }
}
