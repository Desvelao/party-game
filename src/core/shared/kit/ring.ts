// Fixed-capacity history of the latest values (the bots keep their last decisions to explain an incident).
// Circular, so a push never moves the other entries; `toArray()` copies and is meant for the rare read.

export class Ring<T> {
  private items: T[] = [];
  private next = 0;

  constructor(readonly capacity: number) {}

  get length(): number {
    return this.items.length;
  }

  push(item: T): void {
    if (this.items.length < this.capacity) this.items.push(item);
    else {
      this.items[this.next] = item;
      this.next = (this.next + 1) % this.capacity;
    }
  }

  /** the entries, oldest first */
  toArray(): T[] {
    return this.items.length < this.capacity ? this.items.slice() : [...this.items.slice(this.next), ...this.items.slice(0, this.next)];
  }
}
