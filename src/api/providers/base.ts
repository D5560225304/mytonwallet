import type { OnApiUpdate } from '../types';
import type { Methods, MethodArgs, MethodResponse } from '../methods/types';

import { StorageType } from '../storages/types';

import init from '../methods/init';
import * as methods from '../methods';

// eslint-disable-next-line no-restricted-globals
export function initApi(onUpdate: OnApiUpdate, storageType: StorageType) {
  init(onUpdate, storageType);
}

export function callApi<T extends keyof Methods>(fnName: T, ...args: MethodArgs<T>): MethodResponse<T> {
  // @ts-ignore
  return methods[fnName](...args) as MethodResponse<T>;
}
