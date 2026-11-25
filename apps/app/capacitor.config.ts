import type { CapacitorConfig } from '@capacitor/cli';

// App Android per palmari e monitor cucina: stessa interfaccia della cassa.
// I palmari non parlano con le stampanti: mettono i lavori in coda e stampa la cassa.
const config: CapacitorConfig = {
  appId: 'it.gestionale.palmare',
  appName: 'Palmare',
  webDir: 'dist',
  android: { backgroundColor: '#0f1216' },
};

export default config;
