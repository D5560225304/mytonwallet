import type {
  CancellableCallback, OriginMessageEvent, OriginMessageData, WorkerMessageData, ApiUpdate,
} from './PostMessageConnector';

import { DEBUG } from '../config';

declare const self: WorkerGlobalScope;

const callbackState = new Map<string, CancellableCallback>();

type ApiConfig =
  ((name: string, ...args: any[]) => any | [any, ArrayBuffer[]])
  | Record<string, Function>;
type SendToOrigin = (data: WorkerMessageData, arrayBuffers?: ArrayBuffer[]) => void;

export function createWorkerInterface(api: ApiConfig, channel?: string) {
  function sendToOrigin(data: WorkerMessageData, arrayBuffers?: ArrayBuffer[]) {
    data.channel = channel;

    if (arrayBuffers) {
      postMessage(data, arrayBuffers);
    } else {
      postMessage(data);
    }
  }

  handleErrors(sendToOrigin);

  onmessage = (message: OriginMessageEvent) => {
    if (message.data?.channel === channel) {
      onMessage(api, message.data, sendToOrigin);
    }
  };
}

export function createExtensionInterface(
  portName: string,
  api: ApiConfig,
  channel?: string,
  autoInit?: (onUpdate: (update: ApiUpdate) => void) => void,
  cleanUpdater?: (onUpdate: (update: ApiUpdate) => void) => void,
) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== portName) {
      return;
    }

    const dAppUpdater = (update: ApiUpdate) => {
      sendToOrigin({
        type: 'update',
        update,
      });
    };

    function sendToOrigin(data: WorkerMessageData) {
      data.channel = channel;
      port.postMessage(data);
    }

    handleErrors(sendToOrigin);

    port.onMessage.addListener((data: OriginMessageData) => {
      if (data.channel === channel) {
        onMessage(api, data, sendToOrigin);
      }
    });

    autoInit?.(dAppUpdater);

    port.onDisconnect.addListener(() => {
      cleanUpdater?.(dAppUpdater);
    });
  });
}

async function onMessage(
  api: ApiConfig,
  data: OriginMessageData,
  sendToOrigin: SendToOrigin,
) {
  function onUpdate(update: ApiUpdate) {
    sendToOrigin({
      type: 'update',
      update,
    });
  }

  switch (data.type) {
    case 'init': {
      const { args } = data;
      const promise = typeof api === 'function' ? api('init', onUpdate, ...args) : api.init?.(onUpdate, ...args);
      await promise;

      break;
    }
    case 'callMethod': {
      const { messageId, name, args } = data;
      try {
        if (messageId) {
          const callback = (...callbackArgs: any[]) => {
            const lastArg = callbackArgs[callbackArgs.length - 1];

            sendToOrigin({
              type: 'methodCallback',
              messageId,
              callbackArgs,
            }, lastArg instanceof ArrayBuffer ? [lastArg] : undefined);
          };

          callbackState.set(messageId, callback);

          args.push(callback as never);
        }

        const response = typeof api === 'function' ? await api(name, ...args) : await api[name](...args);
        const { arrayBuffer } = (typeof response === 'object' && 'arrayBuffer' in response && response) || {};

        if (messageId) {
          sendToOrigin(
            {
              type: 'methodResponse',
              messageId,
              response,
            },
            arrayBuffer ? [arrayBuffer] : undefined,
          );
        }
      } catch (error: any) {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.error(error);
        }

        if (messageId) {
          sendToOrigin({
            type: 'methodResponse',
            messageId,
            error: { message: error.message },
          });
        }
      }

      if (messageId) {
        callbackState.delete(messageId);
      }

      break;
    }
    case 'cancelProgress': {
      const callback = callbackState.get(data.messageId);
      if (callback) {
        callback.isCanceled = true;
      }

      break;
    }
  }
}

function handleErrors(sendToOrigin: SendToOrigin) {
  self.onerror = (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    sendToOrigin({ type: 'unhandledError', error: { message: e.error.message || 'Uncaught exception in worker' } });
  };

  self.addEventListener('unhandledrejection', (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    sendToOrigin({ type: 'unhandledError', error: { message: e.reason.message || 'Uncaught rejection in worker' } });
  });
}
