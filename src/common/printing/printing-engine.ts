/**
 * Lazy-load boundary for the printing feature. The service imports this module
 * dynamically, so everything reachable from here — the Niimbot protocol, the Web
 * Bluetooth transport, the canvas renderer, and JsBarcode — is split into a chunk
 * that only downloads when someone actually prints. Keep this module's static
 * imports limited to that heavy code.
 */
import { LabelPrinter } from './label-printer';
import { NiimbotWebBluetoothPrinter } from './niimbot/niimbot-web-bluetooth-printer';

export { renderLabel } from './label-renderer';

export function createPrinter(): LabelPrinter {
  return new NiimbotWebBluetoothPrinter();
}
