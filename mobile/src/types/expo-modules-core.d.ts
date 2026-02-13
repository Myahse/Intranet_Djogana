/**
 * Ambient type declarations for expo-modules-core.
 *
 * The expo-modules-core npm package ships only native (Android/iOS) code in
 * this project's node_modules, so TypeScript cannot resolve the types that
 * other Expo packages (e.g. expo-notifications) import from it.
 *
 * This file provides the subset of types that the project actually depends on.
 * It can be removed once the package ships its own .d.ts files again.
 */
declare module "expo-modules-core" {
  export enum PermissionStatus {
    DENIED = "denied",
    GRANTED = "granted",
    UNDETERMINED = "undetermined",
  }

  export type PermissionExpiration = "never" | number;

  export interface PermissionResponse {
    status: PermissionStatus;
    expires: PermissionExpiration;
    granted: boolean;
    canAskAgain: boolean;
  }

  export interface EventSubscription {
    remove(): void;
  }

  export class NativeModule<TEventsMap extends Record<never, never> = Record<never, never>> {
    addListener<EventName extends keyof TEventsMap>(
      eventName: EventName,
      listener: TEventsMap[EventName]
    ): EventSubscription;
    removeAllListeners(eventName: keyof TEventsMap): void;
  }

  export interface ProxyNativeModule {
    addListener(eventName: string): void;
    removeListeners(count: number): void;
    [key: string]: unknown;
  }
}
