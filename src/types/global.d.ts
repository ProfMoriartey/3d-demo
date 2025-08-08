export {};

declare global {
  interface Window {
    Ammo?: (config?: any) => Promise<any>;
  }
}
