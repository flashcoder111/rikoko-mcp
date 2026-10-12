/** One graph per player. A GainNode keeps preview gain above 100% audible. */
export class PreviewAudio {
  private context?: AudioContext;
  private nodes = new WeakMap<
    HTMLMediaElement,
    { gain: GainNode; source: MediaElementAudioSourceNode }
  >();
  private active = new Set<HTMLMediaElement>();
  resume() {
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => {});
  }
  setGain(element: HTMLMediaElement, value: number) {
    if (!this.context) {
      element.volume = Math.min(1, value);
      return;
    }
    let node = this.nodes.get(element);
    if (!node) {
      node = {
        gain: this.context.createGain(),
        source: this.context.createMediaElementSource(element),
      };
      this.nodes.set(element, node);
    }
    if (!this.active.has(element)) {
      node.source.connect(node.gain);
      node.gain.connect(this.context.destination);
      this.active.add(element);
    }
    element.volume = 1;
    node.gain.gain.value = value;
  }
  retain(elements: (HTMLMediaElement | null)[]) {
    for (const element of this.active) {
      if (elements.includes(element)) continue;
      element.pause();
      const node = this.nodes.get(element)!;
      node.source.disconnect();
      node.gain.disconnect();
      this.active.delete(element);
    }
  }
  close() {
    this.retain([]);
    if (this.context) void this.context.close();
    this.context = undefined;
    this.nodes = new WeakMap();
  }
}
