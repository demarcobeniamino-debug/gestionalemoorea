// Funzioni native dei palmari Android (Capacitor). Nel browser e su Windows non fanno nulla.
import { Capacitor } from '@capacitor/core';

export const suAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/** Schermo sempre acceso durante il servizio. */
export async function tieniAcceso() {
  if (!suAndroid()) return;
  const { KeepAwake } = await import('@capacitor-community/keep-awake');
  await KeepAwake.keepAwake();
}

/** Vibrazione breve di conferma (comanda inviata). */
export async function vibra() {
  if (!suAndroid()) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  await Haptics.impact({ style: ImpactStyle.Medium });
}
