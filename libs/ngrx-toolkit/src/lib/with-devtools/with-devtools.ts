import {
  EmptyFeatureResult,
  PartialStateUpdater,
  patchState as originalPatchState, signalStoreFeature,
  SignalStoreFeature, withHooks, withMethods,
  WritableStateSource
} from '@ngrx/signals';
import { inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { Prettify } from '../shared/prettify';
import { DEFAULT_DEVTOOLS_CONFIG, DEVTOOLS_CONFIG } from './with-devtools.config';

declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION__:
      | {
          connect: (options: { name: string }) => {
            send: (action: Action, state: Record<string, unknown>) => void;
          };
          disconnect: () => void;
        }
      | undefined;
  }
}

export type Action = { type: string };

const storeRegistry = signal<Record<string, Signal<unknown>>>({});

const getRootState = () => Object.entries(storeRegistry()).reduce((acc, [name, store]) => {
  acc[name] = store();
  return acc;
}, {} as Record<string, unknown>);


function getValueFromSymbol(obj: unknown, symbol: symbol) {
  if (typeof obj === 'object' && obj && symbol in obj) {
    return (obj as { [key: symbol]: any })[symbol];
  }
}

function getStoreSignal(store: unknown): Signal<unknown> {
  const [signalStateKey] = Object.getOwnPropertySymbols(store);
  if (!signalStateKey) {
    throw new Error('Cannot find State Signal');
  }

  return getValueFromSymbol(store, signalStateKey);
}

type ConnectResponse = {
  send: (action: Action, state: Record<string, unknown>) => void;
};
let connection: ConnectResponse | undefined;

/**
 * required for testing. is not exported during build
 */
export function reset() {
  connection = undefined;
}

/**
 * @param name store's name as it should appear in the DevTools
 */
export function withDevtools<Input extends EmptyFeatureResult>(
  name: string
): SignalStoreFeature<Input, EmptyFeatureResult> {
  return store => {

    const { logOnly } = inject(DEVTOOLS_CONFIG, { optional: true }) || DEFAULT_DEVTOOLS_CONFIG;
    const isServer = isPlatformServer(inject(PLATFORM_ID));
    if (isServer || logOnly) {
      return store;
    }

    return signalStoreFeature(
      withMethods(store => Object.keys(store).reduce((methods, actionName) => {
          const maybeActionCreator = (store as Record<string, (...args: unknown[]) => unknown>)[actionName];
          if ('type' in maybeActionCreator) {
            methods[actionName] = (...args) => {
              const action = maybeActionCreator(...args);
              if (connection) {
                connection.send(action as Action, getRootState());
              }
              return action;
            };
          }
          return methods;
        }, {} as Record<string, () => void>)
      ),
      withHooks({
        onInit(store) {
          const extensions = window.__REDUX_DEVTOOLS_EXTENSION__;
          if (!extensions) {
            return;
          }

          const storeSignal = getStoreSignal(store);
          storeRegistry.update((value) => ({
            ...value,
            [name]: storeSignal
          }));

          if (!connection) {
            connection = extensions.connect({
              name: 'NgRx Signal Store'
            });
          }
        },
        onDestroy() {
          storeRegistry.update((value) => {
            delete value[name];
            return value;
          });

          if (Object.keys(storeRegistry()).length === 0) {
            window.__REDUX_DEVTOOLS_EXTENSION__?.disconnect();
          }
        }
      })
    )(store);
  };
}

type PatchFn = typeof originalPatchState extends (
  arg1: infer First,
  ...args: infer Rest
) => infer Returner
  ? (state: First, action: string, ...rest: Rest) => Returner
  : never;

/**
 * @deprecated No longer required, use regular `patchState` from `@ngrx/signals`
 */
export const patchState: PatchFn = (state, action, ...rest) => {
  updateState(state, action, ...rest);
};

/**
 * @deprecated No longer required, use regular `patchState` from `@ngrx/signals`
 */
export function updateState<State extends object>(
  stateSource: WritableStateSource<State>,
  action: string,
  ...updaters: Array<
    Partial<Prettify<State>> | PartialStateUpdater<Prettify<State>>
  >
): void {
  return originalPatchState(stateSource, ...updaters);
}
