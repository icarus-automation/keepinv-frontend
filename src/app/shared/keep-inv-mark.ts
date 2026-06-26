import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * keep inv brand mark — a small pixel "block" that nods to Minecraft's
 * keepInventory. Crisp inline SVG in brand green, sized by the consumer
 * (e.g. `class="h-7 w-7"`). Identity-only (sign-in, sidebar header); it is never
 * an interactive signal, so amber keeps the One Signal Rule.
 */
@Component({
  selector: 'app-keep-inv-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 10 10" shape-rendering="crispEdges" class="block h-full w-full" focusable="false">
      <rect x="1" y="1" width="8" height="8" class="text-brand" fill="currentColor" />
      <rect x="1" y="1" width="8" height="3" class="text-brand-grass" fill="currentColor" />
      <rect x="3" y="5" width="1" height="1" class="text-brand-grass" fill="currentColor" fill-opacity="0.7" />
      <rect x="6" y="6" width="1" height="1" class="text-brand-grass" fill="currentColor" fill-opacity="0.7" />
    </svg>
  `,
})
export class KeepInvMark {}
